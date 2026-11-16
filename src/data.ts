import type { FeatureCollection, Polygon } from 'geojson'
import { GROUP_IDS } from './engine/types.ts'
import type { BiodiversityData, Cell, GroupId, SpeciesInfo } from './engine/types.ts'

export interface Meta {
  years: [number, number]; groups: Record<GroupId, string>; iucn_scale: Record<string, string>
  sources: { name: string; license: string; url: string }[]; stats: Record<string, number>; n_cells: number; n_species: number; bbox: number[]
}
export interface Loaded { data: BiodiversityData; grid: FeatureCollection<Polygon>; meta: Meta }

const base = import.meta.env.BASE_URL
async function getJson<T>(name: string): Promise<T> {
  const r = await fetch(`${base}data/${name}`)
  if (!r.ok) throw new Error(`${name} : HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export async function loadAll(): Promise<Loaded> {
  const [grid, sp, cellSpecies, meta] = await Promise.all([
    getJson<FeatureCollection<Polygon>>('grid.geojson'), getJson<{ rows: [string, GroupId, number | null, number][] }>('species.json'),
    getJson<Record<string, number[]>>('cell_species.json'), getJson<Meta>('meta.json'),
  ])
  const species: SpeciesInfo[] = sp.rows.map(([name, group, iucn, prot]) => ({ name, group, iucn, protected: !!prot }))
  const cells: Cell[] = grid.features.map((f) => {
    const p = f.properties as Record<string, number | string>
    const ring = f.geometry.coordinates[0]
    const spG = {} as Record<GroupId, number>
    for (const g of GROUP_IDS) spG[g] = Number(p[`sp_${g}`] ?? 0)
    return { id: String(p.id), bbox: [ring[0][0], ring[0][1], ring[2][0], ring[2][1]], obs: Number(p.obs), sp: Number(p.sp), thr: Number(p.thr), nt: Number(p.nt), spG }
  })
  return { data: { cells, cellSpecies, species }, grid, meta }
}
