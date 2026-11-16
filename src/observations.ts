/** Observations individuelles (public/data/observations.json, colonnaire) : chargement, filtres, fiches, synthèse de zone. */
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import * as turf from '@turf/turf'
import { GROUP_IDS } from './engine/types.ts'
import type { GroupId, SpeciesInfo } from './engine/types.ts'

export interface ObsStore {
  n: number
  lat: Float64Array; lon: Float64Array; date: Int32Array; sp: Uint16Array; ds: Uint8Array; loc: Uint16Array
  datasets: string[]; localities: string[]; start: number[]
}
interface Raw { origin: [number, number]; datasets: string[]; localities: string[]; start: number[]; lat: number[]; lon: number[]; date: number[]; ds: number[]; loc: number[] }

export async function loadObservations(base: string, nSpecies: number): Promise<ObsStore> {
  const r = await fetch(`${base}data/observations.json`)
  if (!r.ok) throw new Error(`observations.json : HTTP ${r.status}`)
  const d = (await r.json()) as Raw
  const n = d.lat.length
  const lat = new Float64Array(n), lon = new Float64Array(n), sp = new Uint16Array(n)
  for (let i = 0; i < n; i++) { lat[i] = d.origin[0] + d.lat[i] / 1e4; lon[i] = d.origin[1] + d.lon[i] / 1e4 }
  for (let s = 0; s < nSpecies; s++) for (let i = d.start[s]; i < d.start[s + 1]; i++) sp[i] = s
  return { n, lat, lon, sp, date: Int32Array.from(d.date), ds: Uint8Array.from(d.ds), loc: Uint16Array.from(d.loc), datasets: d.datasets, localities: d.localities, start: d.start }
}

export const yearOf = (ymd: number) => Math.floor(ymd / 10000)
export function fmtDate(ymd: number): string {
  if (!ymd) return 'non renseignée'
  const y = yearOf(ymd), m = Math.floor(ymd / 100) % 100, d = ymd % 100
  return m && d ? `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}` : String(y)
}
export const placeOf = (o: ObsStore, i: number) => (o.loc[i] ? o.localities[o.loc[i] - 1] : `lieu-dit non renseigné (${o.lat[i].toFixed(4)}, ${o.lon[i].toFixed(4)})`)

export interface ObsFilter { groups: Set<GroupId>; iucn: string; yearMin: number; yearMax: number }
/** iucn : '' tous | 'threat' VU/EN/CR | 'nt' | 'lc' | 'dd' (0 = non évalué / données insuffisantes) | 'none' (statut absent) */
export function matches(f: ObsFilter, o: ObsStore, species: SpeciesInfo[], i: number): boolean {
  const s = species[o.sp[i]]
  if (!f.groups.has(s.group)) return false
  const y = yearOf(o.date[i])
  if (y && (y < f.yearMin || y > f.yearMax)) return false
  if (!y && (f.yearMin > 0 && f.yearMin > 1800)) return false
  switch (f.iucn) {
    case 'threat': return s.iucn !== null && s.iucn >= 3
    case 'nt': return s.iucn === 2
    case 'lc': return s.iucn === 1
    case 'dd': return s.iucn === 0
    case 'none': return s.iucn === null
    default: return true
  }
}
export function filteredIndices(f: ObsFilter, o: ObsStore, species: SpeciesInfo[]): Int32Array {
  const out = new Int32Array(o.n); let k = 0
  for (let i = 0; i < o.n; i++) if (matches(f, o, species, i)) out[k++] = i
  return out.subarray(0, k)
}
export function toPoints(idx: Int32Array, o: ObsStore, species: SpeciesInfo[]): FeatureCollection<Point> {
  const features: Feature<Point>[] = new Array(idx.length)
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]
    features[k] = { type: 'Feature', properties: { i, g: GROUP_IDS.indexOf(species[o.sp[i]].group) }, geometry: { type: 'Point', coordinates: [o.lon[i], o.lat[i]] } }
  }
  return { type: 'FeatureCollection', features }
}

export interface SpeciesHistory {
  count: number; first: number; last: number
  byYear: { year: number; n: number }[]; datasets: { name: string; n: number }[]
  latest: { i: number; date: number }[]
}
export function speciesHistory(o: ObsStore, id: number): SpeciesHistory {
  const a = o.start[id], b = o.start[id + 1]
  const yrs = new Map<number, number>(), ds = new Map<number, number>()
  let first = 0, last = 0
  for (let i = a; i < b; i++) {
    const y = yearOf(o.date[i]); if (y) { yrs.set(y, (yrs.get(y) ?? 0) + 1); if (!first || y < first) first = y; if (y > last) last = y }
    ds.set(o.ds[i], (ds.get(o.ds[i]) ?? 0) + 1)
  }
  const latest = Array.from({ length: b - a }, (_, k) => ({ i: a + k, date: o.date[a + k] })).sort((x, y) => y.date - x.date).slice(0, 8)
  return {
    count: b - a, first, last,
    byYear: [...yrs].sort((x, y) => x[0] - y[0]).map(([year, n]) => ({ year, n })),
    datasets: [...ds].sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ name: o.datasets[k], n })), latest,
  }
}

export interface ZoneSummary {
  total: number; speciesIds: number[]; byGroup: Record<GroupId, { obs: number; sp: number }>
  threatened: number[]; nearThreatened: number[]; unassessed: number; first: number; last: number; datasets: { name: string; n: number }[]
}
export function summarizeZone(zone: Feature<Polygon | MultiPolygon>, idx: Int32Array, o: ObsStore, species: SpeciesInfo[]): ZoneSummary {
  const [w, s, e, n] = turf.bbox(zone)
  const sp = new Set<number>(), ds = new Map<number, number>()
  const byGroup = Object.fromEntries(GROUP_IDS.map((g) => [g, { obs: 0, sp: 0 }])) as ZoneSummary['byGroup']
  const gsp = Object.fromEntries(GROUP_IDS.map((g) => [g, new Set<number>()])) as Record<GroupId, Set<number>>
  let total = 0, first = 0, last = 0
  for (const i of idx) {
    const x = o.lon[i], y = o.lat[i]
    if (x < w || x > e || y < s || y > n) continue
    if (!turf.booleanPointInPolygon([x, y], zone)) continue
    total++; sp.add(o.sp[i]); ds.set(o.ds[i], (ds.get(o.ds[i]) ?? 0) + 1)
    const g = species[o.sp[i]].group; byGroup[g].obs++; gsp[g].add(o.sp[i])
    const yr = yearOf(o.date[i]); if (yr) { if (!first || yr < first) first = yr; if (yr > last) last = yr }
  }
  for (const g of GROUP_IDS) byGroup[g].sp = gsp[g].size
  const ids = [...sp]
  return {
    total, speciesIds: ids, byGroup, first, last,
    threatened: ids.filter((id) => (species[id].iucn ?? 0) >= 3), nearThreatened: ids.filter((id) => species[id].iucn === 2),
    unassessed: ids.filter((id) => species[id].iucn === null).length,
    datasets: [...ds].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ name: o.datasets[k], n })),
  }
}
