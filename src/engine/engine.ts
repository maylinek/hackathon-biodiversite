/** Moteur de simulation : module pur, sans dépendance à l'UI. Indice HEURISTIQUE, non prédictif. */
import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { MODEL, PRESETS } from './config.ts'
import { GROUP_IDS } from './types.ts'
import type {
  BiodiversityData, Cell, CellImpact, ConfidenceLevel, Footprint, GroupId, GroupResult, ImpactLevel,
  ProjectParams, SimulationResult,
} from './types.ts'

type Area = Feature<Polygon | MultiPolygon>
export interface References { sp: number; thr: number; groups: Record<GroupId, number> }

function percentile(values: number[], p: number): number {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b)
  if (!v.length) return 1
  return v[Math.min(v.length - 1, Math.floor(p * v.length))]
}

/** Références nationales de normalisation (percentile 95 des cellules). */
export function computeReferences(cells: Cell[]): References {
  const p = MODEL.referencePercentile
  const groups = {} as Record<GroupId, number>
  for (const g of GROUP_IDS) groups[g] = percentile(cells.map((c) => c.spG[g] ?? 0), p)
  return { sp: percentile(cells.map((c) => c.sp), p), thr: percentile(cells.map((c) => c.thr), p), groups }
}

export function cellValue(c: Cell, r: References): number {
  return MODEL.weightRichness * Math.min(1, c.sp / r.sp) + MODEL.weightThreatened * Math.min(1, c.thr / r.thr)
}
export function cellGroupValue(c: Cell, g: GroupId, r: References): number {
  return Math.min(1, (c.spG[g] ?? 0) / r.groups[g])
}

/** Emprise (polygone) à partir du tracé : ligne tamponnée ou polygone mis à l'échelle. */
export function buildFootprint(shape: Footprint, params: ProjectParams): Area {
  if (shape.geometry.type === 'LineString') {
    return turf.buffer(shape, Math.max(1, params.widthM) / 2000, { units: 'kilometers' }) as Area
  }
  const poly = shape as Feature<Polygon>
  return params.scalePct === 100 ? poly : (turf.transformScale(poly, params.scalePct / 100) as Feature<Polygon>)
}

function overlapFraction(cellPoly: Area, zone: Area, cellArea: number): number {
  try {
    const inter = turf.intersect(turf.featureCollection([cellPoly, zone]))
    return inter ? Math.min(1, turf.area(inter) / cellArea) : 0
  } catch {
    return 0
  }
}

function impactLevel(score: number): ImpactLevel {
  const l = MODEL.levels
  return score < l.moderate ? 'low' : score < l.high ? 'moderate' : score < l.veryHigh ? 'high' : 'veryHigh'
}
const saturate = (index: number) => 100 * (1 - Math.exp(-index / MODEL.saturation))

function weightedMedian(items: { v: number; w: number }[]): number {
  const s = items.filter((i) => i.w > 0).sort((a, b) => a.v - b.v)
  const total = s.reduce((a, i) => a + i.w, 0)
  let acc = 0
  for (const i of s) { acc += i.w; if (acc >= total / 2) return i.v }
  return 0
}

export function emptyResult(warnings: string[] = []): SimulationResult {
  const byGroup = {} as Record<GroupId, GroupResult>
  for (const g of GROUP_IDS) byGroup[g] = { score: 0, speciesAffected: 0, threatened: 0 }
  return {
    score: 0, level: 'low', directIndex: 0, indirectIndex: 0, compensatedIndex: 0, byGroup, speciesAffected: 0,
    threatenedAffected: 0, nearThreatenedAffected: 0, species: [], cells: [],
    confidence: { level: 'none', weightedMedianObs: 0, lowDataShare: 1 }, footprintHa: 0, lengthKm: null, warnings,
  }
}

/** Scénario de référence « sans projet » : aucun impact, aucune estimation. */
export const baselineResult = (): SimulationResult => ({ ...emptyResult(), confidence: { level: 'high', weightedMedianObs: 0, lowDataShare: 0 } })

export function simulate(shape: Footprint, params: ProjectParams, data: BiodiversityData, refs: References = computeReferences(data.cells)): SimulationResult {
  const cfg = PRESETS[params.preset]
  const ph = cfg.phase[params.phase]
  const footprint = buildFootprint(shape, params)
  const R = Math.max(0, params.radiusM) / 1000
  const nR = MODEL.rings
  const zones: Area[] = R > 0
    ? Array.from({ length: nR }, (_, k) => turf.buffer(footprint, (R * (k + 1)) / nR, { units: 'kilometers' }) as Area)
    : []
  const outer = zones.length ? zones[zones.length - 1] : footprint
  const [bw, bs, be, bn] = turf.bbox(outer)
  const comp = Math.min(100, Math.max(0, params.compensationPct)) / 100
  const directKeep = 1 - cfg.compensationEfficiency * comp
  // décroissance au milieu de chaque anneau
  const ringW = Array.from({ length: nR }, (_, k) => Math.pow(1 - (k + 0.5) / nR, MODEL.decayExponent))

  let direct = 0, indirect = 0, compensated = 0
  const gDirect = {} as Record<GroupId, number>, gInd = {} as Record<GroupId, number>
  for (const g of GROUP_IDS) { gDirect[g] = 0; gInd[g] = 0 }
  const cellsOut: CellImpact[] = []
  const exposure = new Map<number, 'direct' | 'indirect'>()
  const medianItems: { v: number; w: number }[] = []

  for (const c of data.cells) {
    const [w, s, e, n] = c.bbox
    if (e < bw || w > be || n < bs || s > bn) continue
    const cellPoly = turf.bboxPolygon(c.bbox) as Area
    const cellArea = turf.area(cellPoly)
    const f = overlapFraction(cellPoly, footprint, cellArea)
    let ind = 0
    if (zones.length) {
      let prev = f
      for (let k = 0; k < nR; k++) {
        const cum = Math.max(prev, overlapFraction(cellPoly, zones[k], cellArea))
        ind += (cum - prev) * ringW[k]
        prev = cum
      }
    }
    if (f <= 0 && ind <= 0) continue
    const v = cellValue(c, refs)
    const dI = cfg.directCoef * ph.direct * f * v
    const iI = cfg.indirectCoef * ph.indirect * ind * v
    direct += dI * directKeep
    compensated += dI * (1 - directKeep)
    indirect += iI
    for (const g of GROUP_IDS) {
      const vg = cellGroupValue(c, g, refs) * cfg.groupSensitivity[g]
      gDirect[g] += cfg.directCoef * ph.direct * f * vg * directKeep
      gInd[g] += cfg.indirectCoef * ph.indirect * ind * vg
    }
    cellsOut.push({ id: c.id, direct: f, indirect: ind, impact: dI * directKeep + iI })
    medianItems.push({ v: c.obs, w: f + ind })
    for (const id of data.cellSpecies[c.id] ?? []) {
      if (f > 0) exposure.set(id, 'direct')
      else if (!exposure.has(id)) exposure.set(id, 'indirect')
    }
  }

  const res = emptyResult()
  res.score = Math.round(saturate(direct + indirect) * 10) / 10
  res.level = impactLevel(res.score)
  res.directIndex = direct; res.indirectIndex = indirect; res.compensatedIndex = compensated
  res.cells = cellsOut
  res.footprintHa = turf.area(footprint) / 10000
  res.lengthKm = shape.geometry.type === 'LineString' ? turf.length(shape, { units: 'kilometers' }) : null
  for (const [id, ex] of exposure) {
    res.species.push({ id, exposure: ex })
    const sp = data.species[id]
    const gr = res.byGroup[sp.group]
    gr.speciesAffected++
    res.speciesAffected++
    if (sp.iucn !== null && sp.iucn >= 3) { gr.threatened++; res.threatenedAffected++ }
    else if (sp.iucn === 2) res.nearThreatenedAffected++
  }
  for (const g of GROUP_IDS) res.byGroup[g].score = Math.round(saturate(gDirect[g] + gInd[g]) * 10) / 10

  // confiance
  const cc = MODEL.confidence
  const wm = weightedMedian(medianItems)
  const totalW = medianItems.reduce((a, i) => a + i.w, 0)
  const low = totalW ? medianItems.filter((i) => i.v < cc.lowObs).reduce((a, i) => a + i.w, 0) / totalW : 1
  let level: ConfidenceLevel = 'medium'
  const anyObs = medianItems.some((i) => i.v > 0)
  if (!cellsOut.length || !anyObs) level = 'none'
  else if (low > cc.lowShareLow || wm < cc.lowMedianObs) level = 'low'
  else if (low < cc.lowShareHigh && wm >= cc.highMedianObs) level = 'high'
  res.confidence = { level, weightedMedianObs: wm, lowDataShare: low }

  if (!cellsOut.length) res.warnings.push("Aucune cellule de la grille n'est touchée (zone hors du Luxembourg ou emprise trop petite) : score 0 sans valeur informative.")
  else if (!anyObs) res.warnings.push("Aucune observation dans la zone : l'absence de données n'est pas l'absence d'espèces.")
  if (level === 'low') res.warnings.push(`Données peu denses (${Math.round(low * 100)} % de l'influence sur des cellules à moins de ${cc.lowObs} observations) : résultat peu fiable.`)
  res.warnings.push('Statuts IUCN absents pour la majorité des espèces : le nombre d\'espèces menacées est un minimum.')
  if (cfg.help && params.preset === 'restoration') res.warnings.push('Le gain écologique d\'une restauration n\'est pas modélisé.')
  return res
}
