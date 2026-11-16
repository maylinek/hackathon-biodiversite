import { PRESETS } from './engine/config.ts'
import type { Footprint, PresetId, ProjectParams } from './engine/types.ts'

export interface Scenario { id: string; name: string; shape: Footprint | null; params: ProjectParams }
export const BASELINE_ID = 'baseline'
export const PALETTE = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#8c6d1f', '#6a3d9a'] // Okabe-Ito, daltonisme
const KEY = 'dtbl.scenarios.v1'

export function defaultParams(preset: PresetId): ProjectParams {
  const c = PRESETS[preset]
  return { preset, phase: 'operation', radiusM: c.defaultRadiusM, compensationPct: 0, widthM: c.defaultWidthM || 20, scalePct: 100 }
}
export const baseline = (): Scenario => ({ id: BASELINE_ID, name: 'Référence : sans projet', shape: null, params: defaultParams('building') })
export const newId = () => Math.random().toString(36).slice(2, 9)

export function loadSaved(): { scenarios: Scenario[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (!Array.isArray(v.scenarios) || !v.scenarios.some((s: Scenario) => s.id === BASELINE_ID)) return null
    return v
  } catch { return null }
}
export function save(scenarios: Scenario[], activeId: string): boolean {
  try { localStorage.setItem(KEY, JSON.stringify({ scenarios, activeId })); return true } catch { return false }
}
export function colorOf(scenarios: Scenario[], id: string): string {
  if (id === BASELINE_ID) return '#666666'
  const i = scenarios.filter((s) => s.id !== BASELINE_ID).findIndex((s) => s.id === id)
  return PALETTE[i % PALETTE.length]
}
