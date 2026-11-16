import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawLineStringMode, TerraDrawRectangleMode, TerraDrawCircleMode, TerraDrawSelectMode, TerraDrawRenderMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import type { Footprint } from '../engine/types.ts'
import { GROUP_IDS } from '../engine/types.ts'

export const BIO_RAMP = ['#f1e9a8', '#bcd68a', '#7fb77e', '#3f8f6b', '#1f5a46'] // séquentiel beige → vert profond
export const IMPACT_RAMP = ['#fff3b0', '#fdae61', '#e34a33', '#990000', '#3d0000']
export const GROUP_COLORS: Record<string, string> = { bird: '#0072B2', vert: '#D55E00', plant: '#009E73', fung: '#CC79A7', arth: '#E69F00', other: '#6b6b6b' } // Okabe-Ito
export type DrawMode = 'polygon' | 'rectangle' | 'circle' | 'line' | null
export interface FlyTarget { token: number; center?: [number, number]; bbox?: [number, number, number, number]; zoom?: number }
maplibregl.setWorkerUrl(workerUrl)
const STYLE = 'https://tiles.openfreemap.org/styles/positron' // OpenFreeMap : sans clé API
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

interface Props {
  grid: FeatureCollection<Polygon>
  gridVisible: boolean
  prop: string; breaks: number[]
  mode: 'bio' | 'impact'
  impact: FeatureCollection
  impactBreaks: number[]
  shapes: FeatureCollection // props: color, active, kind ('shape' | 'comp' | 'zone')
  zone: FeatureCollection
  obs: FeatureCollection<Point> | null
  obsVisible: boolean
  drawMode: DrawMode
  editing: Footprint | null // forme à éditer (null = pas d'édition)
  fly: FlyTarget | null
  onDrawn: (f: Footprint) => void
  onEdited: (f: Footprint) => void
  onPickObs: (i: number) => void
  onMapError: (m: string) => void
}

const stepExpr = (prop: string, breaks: number[], ramp: string[]) => {
  const e: unknown[] = ['step', ['coalesce', ['get', prop], 0], ramp[0]]
  breaks.forEach((b, i) => e.push(b, ramp[Math.min(i + 1, ramp.length - 1)]))
  return e as maplibregl.ExpressionSpecification
}
const MODES: Record<Exclude<DrawMode, null>, string> = { polygon: 'polygon', rectangle: 'rectangle', circle: 'circle', line: 'linestring' }

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const [ready, setReady] = useState(false)
  const cb = useRef(p); cb.current = p
  const lastDraw = useRef(0)
  const editId = useRef<string | null>(null)

  useEffect(() => {
    const map = new maplibregl.Map({ container: el.current!, style: STYLE, bounds: [5.6, 49.4, 6.65, 50.25], attributionControl: { compact: true }, maxPitch: 0 })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-right')
    map.on('error', (e) => { if (!map.isStyleLoaded() && !map.loaded()) cb.current.onMapError(`Fond de carte indisponible (${e.error?.message ?? 'erreur réseau'}). Les données et les calculs restent utilisables.`) })
    map.on('load', () => {
      map.addSource('grid', { type: 'geojson', data: cb.current.grid })
      map.addSource('impact', { type: 'geojson', data: empty })
      map.addSource('zone', { type: 'geojson', data: empty })
      map.addSource('shapes', { type: 'geojson', data: empty })
      map.addSource('obs', { type: 'geojson', data: empty, cluster: true, clusterRadius: 45, clusterMaxZoom: 14 })
      map.addLayer({ id: 'grid-fill', type: 'fill', source: 'grid', paint: { 'fill-opacity': 0.72, 'fill-color': '#888' } })
      map.addLayer({ id: 'impact-fill', type: 'fill', source: 'impact', layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.8, 'fill-color': '#e34a33' } })
      map.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': '#222', 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      map.addLayer({ id: 'shape-fill', type: 'fill', source: 'shapes', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'kind'], 'comp'], 0.25, ['get', 'active'], 0.35, 0.15] } })
      map.addLayer({ id: 'shape-line', type: 'line', source: 'shapes', paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'active'], 4, 2.5], 'line-dasharray': ['case', ['==', ['get', 'kind'], 'comp'], ['literal', [2, 2]], ['literal', [1, 0]]] } })
      const gcolor: unknown[] = ['match', ['get', 'g']]
      GROUP_IDS.forEach((g, i) => gcolor.push(i, GROUP_COLORS[g])); gcolor.push('#444')
      map.addLayer({ id: 'obs-cluster', type: 'circle', source: 'obs', filter: ['has', 'point_count'], layout: { visibility: 'none' }, paint: { 'circle-color': '#1f5a46', 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-radius': ['step', ['get', 'point_count'], 14, 100, 18, 1000, 24, 10000, 30] } })
      map.addLayer({ id: 'obs-count', type: 'symbol', source: 'obs', filter: ['has', 'point_count'], layout: { visibility: 'none', 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 }, paint: { 'text-color': '#ffffff' } })
      map.addLayer({ id: 'obs-point', type: 'circle', source: 'obs', filter: ['!', ['has', 'point_count']], layout: { visibility: 'none' }, paint: { 'circle-color': gcolor as maplibregl.ExpressionSpecification, 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } })

      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      const busy = () => cb.current.drawMode || cb.current.editing || Date.now() - lastDraw.current < 700
      map.on('click', 'grid-fill', (e) => {
        if (busy() || map.queryRenderedFeatures(e.point, { layers: ['obs-point', 'obs-cluster'] }).length) return
        const f = e.features?.[0]; if (!f) return
        const q = f.properties as Record<string, number>
        popup.setLngLat(e.lngLat).setHTML(`<b>Cellule ≈ 1 km²</b><br>Espèces : ${q.sp}<br>Menacées (IUCN VU/EN/CR, min.) : ${q.thr}<br>Observations : ${q.obs}${q.obs < 5 ? '<br><i>Peu de données : fiabilité faible</i>' : ''}`).addTo(map)
      })
      map.on('click', 'obs-cluster', async (e) => {
        if (busy()) return
        const f = e.features?.[0]; if (!f) return
        const z = await (map.getSource('obs') as maplibregl.GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id as number)
        map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom: z + 0.5 })
      })
      map.on('click', 'obs-point', (e) => { if (busy()) return; const f = e.features?.[0]; if (f) cb.current.onPickObs(Number(f.properties!.i)) })
      for (const l of ['grid-fill', 'obs-cluster', 'obs-point']) {
        map.on('mouseenter', l, () => { if (!cb.current.drawMode && !cb.current.editing) map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', l, () => { map.getCanvas().style.cursor = '' })
      }
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode(), new TerraDrawRectangleMode(), new TerraDrawCircleMode(), new TerraDrawLineStringMode(),
          new TerraDrawSelectMode({ flags: {
            polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
            linestring: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
          } }),
          new TerraDrawRenderMode({ modeName: 'static', styles: {} })],
      })
      draw.start(); draw.setMode('static')
      draw.on('finish', (id, ctx) => {
        const f = draw.getSnapshot().find((x) => x.id === id) as Feature | undefined
        if (!f) return
        const geom = f.geometry
        if (cb.current.editing || (ctx as { mode?: string } | undefined)?.mode === 'select') {
          // fin d'un déplacement / d'une édition de sommet : on remonte la géométrie finale
          if (id === editId.current && (geom.type === 'Polygon' || geom.type === 'LineString')) cb.current.onEdited({ type: 'Feature', properties: {}, geometry: geom })
          return
        }
        lastDraw.current = Date.now(); draw.clear(); draw.setMode('static')
        if (geom.type === 'Polygon' || geom.type === 'LineString') cb.current.onDrawn({ type: 'Feature', properties: {}, geometry: geom })
      })
      drawRef.current = draw
      setReady(true)
    })
    return () => { drawRef.current = null; map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return
    map.setLayoutProperty('grid-fill', 'visibility', p.gridVisible ? 'visible' : 'none')
    map.setPaintProperty('grid-fill', 'fill-color', stepExpr(p.prop, p.breaks, BIO_RAMP))
    map.setFilter('grid-fill', ['>', ['coalesce', ['get', p.prop], 0], 0])
    map.setPaintProperty('grid-fill', 'fill-opacity', p.mode === 'bio' ? 0.65 : 0.12)
    map.setLayoutProperty('impact-fill', 'visibility', p.mode === 'impact' ? 'visible' : 'none')
    map.setPaintProperty('impact-fill', 'fill-color', stepExpr('impact', p.impactBreaks, IMPACT_RAMP))
  }, [ready, p.gridVisible, p.prop, p.breaks, p.mode, p.impactBreaks])
  useEffect(() => { if (ready) (mapRef.current!.getSource('impact') as maplibregl.GeoJSONSource).setData(p.impact) }, [ready, p.impact])
  useEffect(() => { if (ready) (mapRef.current!.getSource('shapes') as maplibregl.GeoJSONSource).setData(p.shapes) }, [ready, p.shapes])
  useEffect(() => { if (ready) (mapRef.current!.getSource('zone') as maplibregl.GeoJSONSource).setData(p.zone) }, [ready, p.zone])
  useEffect(() => { if (ready && p.obs) (mapRef.current!.getSource('obs') as maplibregl.GeoJSONSource).setData(p.obs) }, [ready, p.obs])
  useEffect(() => {
    if (!ready) return
    for (const l of ['obs-cluster', 'obs-count', 'obs-point']) mapRef.current!.setLayoutProperty(l, 'visibility', p.obsVisible ? 'visible' : 'none')
  }, [ready, p.obsVisible])
  useEffect(() => {
    if (!ready || !drawRef.current || p.editing) return
    drawRef.current.setMode(p.drawMode ? MODES[p.drawMode] : 'static')
    mapRef.current!.getCanvas().style.cursor = p.drawMode ? 'crosshair' : ''
  }, [ready, p.drawMode, p.editing])
  // édition d'une forme existante (sélection terra-draw : déplacer, sommets, points milieux)
  const editing = !!p.editing
  useEffect(() => {
    const draw = drawRef.current; if (!ready || !draw) return
    if (editing) {
      const shape = cb.current.editing!
      draw.clear()
      const id = crypto.randomUUID(); editId.current = id
      const res = draw.addFeatures([{ id, type: 'Feature', geometry: shape.geometry, properties: { mode: shape.geometry.type === 'LineString' ? 'linestring' : 'polygon' } }])
      if (res[0]?.valid) { draw.setMode('select'); draw.selectFeature(id) } else cb.current.onMapError(`Édition impossible : ${res[0]?.reason ?? 'forme invalide'}`)
    } else if (editId.current) { editId.current = null; draw.clear(); draw.setMode('static') }
  }, [ready, editing])
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map || !p.fly) return
    if (p.fly.bbox) map.fitBounds(p.fly.bbox, { padding: 60, maxZoom: 16, duration: 900 })
    else if (p.fly.center) map.flyTo({ center: p.fly.center, zoom: p.fly.zoom ?? 14, duration: 900 })
  }, [ready, p.fly])

  return <div ref={el} className="map" role="application" aria-label="Carte du Luxembourg" />
}
