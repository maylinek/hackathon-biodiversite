/** Classement multicritère des scénarios. Plus le score composite est BAS, moins le scénario pèse sur la biodiversité. */
import { RANKING } from './config.ts'
import type { SimulationResult } from './types.ts'

export type CriterionKey = keyof typeof RANKING.defaultWeights
export type Weights = Record<CriterionKey, number>
export const CRITERION_LABELS: Record<CriterionKey, string> = {
  threatened: 'Espèces menacées touchées (IUCN VU/EN/CR)',
  nearThreatened: 'Espèces quasi menacées touchées',
  richness: 'Richesse spécifique touchée',
  lowEffort: 'Surface touchée à faible effort d\'observation (incertitude)',
  fragmentation: 'Fragmentation (km de linéaire en zone observée)',
  compensation: 'Compensation insuffisante (1 − % compensé)',
}
export interface RankInput { id: string; result: SimulationResult; compensationPct: number }
export interface Indicators { threatened: number; nearThreatened: number; richness: number; lowEffort: number; fragmentation: number; compensation: number }
export interface RankedItem {
  id: string; rank: number; composite: number; indicators: Indicators
  normalized: Indicators; tiedWith: string[]; best: boolean
}

export function indicatorsOf(r: SimulationResult, compensationPct: number): Indicators {
  return {
    threatened: r.threatenedAffected, nearThreatened: r.nearThreatenedAffected, richness: r.speciesAffected,
    lowEffort: r.confidence.lowDataShare, fragmentation: r.fragmentationKm ?? 0,
    compensation: 1 - Math.min(100, Math.max(0, compensationPct)) / 100,
  }
}

export function rankScenarios(items: RankInput[], weights: Weights = RANKING.defaultWeights): RankedItem[] {
  if (!items.length) return []
  const keys = Object.keys(weights) as CriterionKey[]
  const wsum = keys.reduce((a, k) => a + Math.max(0, weights[k]), 0) || 1
  const ind = items.map((i) => indicatorsOf(i.result, i.compensationPct))
  const max = {} as Indicators
  for (const k of keys) max[k] = Math.max(...ind.map((x) => x[k]))
  const rows = items.map((it, i) => {
    const normalized = {} as Indicators
    let composite = 0
    for (const k of keys) { normalized[k] = max[k] > 0 ? ind[i][k] / max[k] : 0; composite += (Math.max(0, weights[k]) / wsum) * normalized[k] }
    return { id: it.id, rank: 0, composite, indicators: ind[i], normalized, tiedWith: [] as string[], best: false }
  })
  rows.sort((a, b) => a.composite - b.composite)
  rows.forEach((r, i) => { r.rank = i + 1 })
  for (const a of rows) for (const b of rows) {
    if (a === b) continue
    const margin = RANKING.tieBase + RANKING.tieUncertainty * (a.indicators.lowEffort + b.indicators.lowEffort) / 2
    if (Math.abs(a.composite - b.composite) < margin) a.tiedWith.push(b.id)
  }
  if (rows.length > 1) rows[0].best = true
  return rows
}
