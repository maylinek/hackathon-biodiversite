import type { Feature, LineString, Polygon } from 'geojson'

export type GroupId = 'bird' | 'vert' | 'plant' | 'fung' | 'arth' | 'other'
export const GROUP_IDS: GroupId[] = ['bird', 'vert', 'plant', 'fung', 'arth', 'other']

/** Cellule de grille agrégée (~1 km). Source : public/data/grid.geojson */
export interface Cell {
  id: string
  bbox: [number, number, number, number] // w, s, e, n (WGS84)
  obs: number // observations dédoublonnées (indice de confiance)
  sp: number // richesse spécifique
  thr: number // espèces IUCN VU/EN/CR (minimum)
  nt: number
  spG: Record<GroupId, number>
}
export interface SpeciesInfo { name: string; group: GroupId; iucn: number | null; protected: boolean }
export interface BiodiversityData {
  cells: Cell[]
  cellSpecies: Record<string, number[]>
  species: SpeciesInfo[]
}

export type PresetId = 'building' | 'airport' | 'road' | 'rail' | 'activity' | 'solar' | 'restoration'
export type Phase = 'construction' | 'operation'
export type Footprint = Feature<Polygon | LineString>

export interface ProjectParams {
  preset: PresetId
  phase: Phase
  radiusM: number // rayon d'influence indirecte
  compensationPct: number // 0-100 : % d'emprise restaurée
  widthM: number // largeur d'emprise (projets linéaires)
  scalePct: number // échelle de l'emprise dessinée (polygones), 100 = tel que dessiné
}

export type ConfidenceLevel = 'none' | 'low' | 'medium' | 'high'
export type ImpactLevel = 'low' | 'moderate' | 'high' | 'veryHigh'

export interface GroupResult { score: number; speciesAffected: number; threatened: number }
export interface AffectedSpecies { id: number; exposure: 'direct' | 'indirect' }
export interface CellImpact { id: string; direct: number; indirect: number; impact: number }
export interface SimulationResult {
  score: number // 0-100
  level: ImpactLevel
  directIndex: number // contribution directe (équivalents-cellule), après compensation
  indirectIndex: number
  compensatedIndex: number // impact direct évité grâce à la compensation
  byGroup: Record<GroupId, GroupResult>
  speciesAffected: number
  threatenedAffected: number
  nearThreatenedAffected: number
  species: AffectedSpecies[]
  cells: CellImpact[]
  confidence: { level: ConfidenceLevel; weightedMedianObs: number; lowDataShare: number }
  footprintHa: number
  lengthKm: number | null
  /** Longueur (km) de l'infrastructure linéaire traversant des cellules où des espèces ont été observées ; null si l'emprise n'est pas linéaire. */
  fragmentationKm: number | null
  warnings: string[]
}
