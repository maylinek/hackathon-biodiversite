import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawLineStringMode, TerraDrawRectangleMode, TerraDrawRenderMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { Footprint } from '../engine/types.ts'

export const BIO_RAMP = ['#fde725', '#5ec962', '#21918c', '#3b528b', '#440154'] // viridis, sûre pour le daltonisme
export const IMPACT_RAMP = ['#fff3b0', '#fdae61', '#e34a33', '#990000', '#3d0000']
export type DrawMode = 'polygon' | 'rectangle' | 'line' | null
maplibregl.setWorkerUrl(workerUrl)
const STYLE = 'https://tiles.openfreemap.org/styles/positron' // OpenFreeMap : sans clé API
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

interface Props {
  grid: FeatureCollection<Polygon>
  prop: string; breaks: number[]
  mode: 'bio' | 'impact'
  impact: FeatureCollection // cellules du scénario actif avec propriété "impact"
  impactBreaks: number[]
  shapes: FeatureCollection // emprises des scénarios (props: color, active)
  zone: FeatureCollection // zone d'influence du scénario actif
  drawMode: DrawMode
  onDrawn: (f: Footprint) => void
  onMapError: (m: string) => void
}

const stepExpr = (prop: string, breaks: number[], ramp: string[]) => {
  const e: unknown[] = ['step', ['coalesce', ['get', prop], 0], ramp[0]]
  breaks.forEach((b, i) => e.push(b, ramp[Math.min(i + 1, ramp.length - 1)]))
  return e as maplibregl.ExpressionSpecification
}

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const [ready, setReady] = useState(false)
  const cb = useRef(p); cb.current = p
  const lastDraw = useRef(0)

  useEffect(() => {
    const map = new maplibregl.Map({ container: el.current!, style: STYLE, bounds: [5.6, 49.4, 6.65, 50.25], attributionControl: { compact: true } })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('error', (e) => { if (!map.isStyleLoaded() && !map.loaded()) cb.current.onMapError(`Fond de carte indisponible (${e.error?.message ?? 'erreur réseau'}). Les données et les calculs restent utilisables.`) })
    map.on('load', () => {
      map.addSource('grid', { type: 'geojson', data: cb.current.grid })
      map.addSource('impact', { type: 'geojson', data: empty })
      map.addSource('zone', { type: 'geojson', data: empty })
      map.addSource('shapes', { type: 'geojson', data: empty })
      map.addLayer({ id: 'grid-fill', type: 'fill', source: 'grid', paint: { 'fill-opacity': 0.72, 'fill-color': '#888' } })
      map.addLayer({ id: 'impact-fill', type: 'fill', source: 'impact', layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.8, 'fill-color': '#e34a33' } })
      map.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': '#222', 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      map.addLayer({ id: 'shape-fill', type: 'fill', source: 'shapes', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'active'], 0.35, 0.15] } })
      map.addLayer({ id: 'shape-line', type: 'line', source: 'shapes', paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'active'], 4, 2.5] } })
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      map.on('click', 'grid-fill', (e) => {
        if (cb.current.drawMode || Date.now() - lastDraw.current < 700) return
        const f = e.features?.[0]; if (!f) return
        const q = f.properties as Record<string, number>
        popup.setLngLat(e.lngLat).setHTML(`<b>Cellule ≈ 1 km²</b><br>Espèces : ${q.sp}<br>Menacées (IUCN VU/EN/CR, min.) : ${q.thr}<br>Observations : ${q.obs}${q.obs < 5 ? '<br><i>Peu de données : fiabilité faible</i>' : ''}`).addTo(map)
      })
      map.on('mouseenter', 'grid-fill', () => { if (!cb.current.drawMode) map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'grid-fill', () => { map.getCanvas().style.cursor = '' })
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode(), new TerraDrawRectangleMode(), new TerraDrawLineStringMode(), new TerraDrawRenderMode({ modeName: 'static', styles: {} })],
      })
      draw.start(); draw.setMode('static')
      draw.on('finish', (id) => {
        const f = draw.getSnapshot().find((x) => x.id === id) as Feature | undefined
        if (!f) return
        const geom = f.geometry
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
    map.setPaintProperty('grid-fill', 'fill-color', stepExpr(p.prop, p.breaks, BIO_RAMP))
    map.setFilter('grid-fill', ['>', ['coalesce', ['get', p.prop], 0], 0])
    map.setPaintProperty('grid-fill', 'fill-opacity', p.mode === 'bio' ? 0.72 : 0.12)
    map.setLayoutProperty('impact-fill', 'visibility', p.mode === 'impact' ? 'visible' : 'none')
    map.setPaintProperty('impact-fill', 'fill-color', stepExpr('impact', p.impactBreaks, IMPACT_RAMP))
  }, [ready, p.prop, p.breaks, p.mode, p.impactBreaks])
  useEffect(() => { if (ready) (mapRef.current!.getSource('impact') as maplibregl.GeoJSONSource).setData(p.impact) }, [ready, p.impact])
  useEffect(() => { if (ready) (mapRef.current!.getSource('shapes') as maplibregl.GeoJSONSource).setData(p.shapes) }, [ready, p.shapes])
  useEffect(() => { if (ready) (mapRef.current!.getSource('zone') as maplibregl.GeoJSONSource).setData(p.zone) }, [ready, p.zone])
  useEffect(() => {
    if (!ready || !drawRef.current) return
    drawRef.current.setMode(p.drawMode === 'line' ? 'linestring' : p.drawMode ?? 'static')
    mapRef.current!.getCanvas().style.cursor = p.drawMode ? 'crosshair' : ''
  }, [ready, p.drawMode])

  return <div ref={el} className="map" role="application" aria-label="Carte du Luxembourg" />
}
