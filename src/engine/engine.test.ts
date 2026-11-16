import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as turf from '@turf/turf'
import { simulate, computeReferences } from './engine.ts'
import { GROUP_IDS } from './types.ts'
import type { BiodiversityData, Cell, ProjectParams, SpeciesInfo } from './types.ts'

const DLAT = 0.009, DLON = 0.01395, LON0 = 6.0, LAT0 = 49.6
function makeData(density: (ix: number, iy: number) => { sp: number; obs: number; thr: number }): BiodiversityData {
  const cells: Cell[] = []; const cellSpecies: Record<string, number[]> = {}
  const species: SpeciesInfo[] = Array.from({ length: 40 }, (_, i) => ({ name: `Sp${i}`, group: GROUP_IDS[i % 6], iucn: i % 5 === 0 ? 4 : null, protected: false }))
  for (let ix = 0; ix < 20; ix++) for (let iy = 0; iy < 20; iy++) {
    const d = density(ix, iy); const id = `${ix}_${iy}`
    const spG = Object.fromEntries(GROUP_IDS.map((g) => [g, Math.round(d.sp / 6)])) as Cell['spG']
    cells.push({ id, bbox: [LON0 + ix * DLON, LAT0 + iy * DLAT, LON0 + (ix + 1) * DLON, LAT0 + (iy + 1) * DLAT], obs: d.obs, sp: d.sp, thr: d.thr, nt: 0, spG })
    cellSpecies[id] = d.sp ? [0, 1, 2, 3, 4, 5] : []
  }
  return { cells, cellSpecies, species }
}
const dense = makeData(() => ({ sp: 100, obs: 200, thr: 5 }))
const empty = makeData(() => ({ sp: 0, obs: 0, thr: 0 }))
const centre = [LON0 + 10 * DLON, LAT0 + 10 * DLAT]
const square = (halfKm: number) => turf.bboxPolygon(turf.bbox(turf.buffer(turf.point(centre), halfKm, { units: 'kilometers' })!))
const base: ProjectParams = { preset: 'building', phase: 'operation', radiusM: 500, compensationPct: 0, widthM: 20, scalePct: 100 }

test('zone vide : score 0 et confiance nulle', () => {
  const refs = computeReferences(dense.cells)
  const r = simulate(square(0.4), base, empty, refs)
  assert.equal(r.score, 0)
  assert.equal(r.confidence.level, 'none')
  assert.ok(r.warnings.length > 0)
})

test('zone dense : score > 0, confiance haute, espèces touchées', () => {
  const r = simulate(square(0.5), base, dense)
  assert.ok(r.score > 5, `score ${r.score}`)
  assert.equal(r.confidence.level, 'high')
  assert.ok(r.speciesAffected > 0 && r.threatenedAffected > 0)
  assert.ok(r.directIndex > 0 && r.indirectIndex > 0)
})

test('zone dense plus impactante qu\'une zone clairsemée (même projet)', () => {
  const sparse = makeData(() => ({ sp: 10, obs: 3, thr: 0 }))
  const refs = computeReferences(dense.cells)
  assert.ok(simulate(square(0.5), base, dense, refs).score > simulate(square(0.5), base, sparse, refs).score)
  assert.equal(simulate(square(0.5), base, sparse, refs).confidence.level, 'low')
})

test('projet linéaire : emprise = ligne tamponnée, longueur renseignée, route > rien', () => {
  const line = turf.lineString([[centre[0] - 0.05, centre[1]], [centre[0] + 0.05, centre[1]]])
  const r = simulate(line, { ...base, preset: 'road' }, dense)
  assert.ok(r.lengthKm! > 5)
  assert.ok(Math.abs(r.footprintHa - r.lengthKm! * 20 * 0.1) / r.footprintHa < 0.05) // L(km)*largeur(m)/10 = ha
  assert.ok(r.score > 0)
  const wide = simulate(line, { ...base, preset: 'road', widthM: 100 }, dense)
  assert.ok(wide.directIndex > r.directIndex)
})

test('compensation 100 % : impact direct réduit selon l\'efficacité, jamais négatif', () => {
  const r0 = simulate(square(0.5), base, dense)
  const r1 = simulate(square(0.5), { ...base, compensationPct: 100 }, dense)
  assert.ok(r1.directIndex < r0.directIndex)
  assert.ok(Math.abs(r1.directIndex + r1.compensatedIndex - r0.directIndex) < 1e-9)
  assert.ok(r1.directIndex >= 0 && r1.score < r0.score)
  assert.equal(r1.indirectIndex, r0.indirectIndex) // la compensation ne réduit pas l'indirect
})

test('rayon d\'influence nul : aucun impact indirect', () => {
  assert.equal(simulate(square(0.5), { ...base, radiusM: 0 }, dense).indirectIndex, 0)
})

import { rankScenarios } from './ranking.ts'
test('fragmentation : null pour un polygone, > 0 pour une ligne en zone observée', () => {
  assert.equal(simulate(square(0.5), base, dense).fragmentationKm, null)
  const line = turf.lineString([[centre[0] - 0.05, centre[1]], [centre[0] + 0.05, centre[1]]])
  const r = simulate(line, { ...base, preset: 'road' }, dense)
  assert.ok(r.fragmentationKm! > 5 && r.fragmentationKm! <= r.lengthKm! * 1.01)
  assert.equal(simulate(line, { ...base, preset: 'road' }, empty).fragmentationKm, 0)
})

test('classement : le scénario le moins impactant est premier ; la compensation améliore le rang', () => {
  const refs = computeReferences(dense.cells)
  const small = simulate(square(0.3), base, dense, refs), big = simulate(square(1.5), { ...base, radiusM: 2000 }, dense, refs)
  const bigThr = { ...big, threatenedAffected: small.threatenedAffected + 10, speciesAffected: small.speciesAffected + 30 }
  const r = rankScenarios([{ id: 'big', result: bigThr, compensationPct: 0 }, { id: 'small', result: small, compensationPct: 0 }])
  assert.equal(r[0].id, 'small'); assert.ok(r[0].best); assert.equal(r[1].rank, 2)
  const r2 = rankScenarios([{ id: 'a', result: small, compensationPct: 0 }, { id: 'b', result: small, compensationPct: 80 }])
  assert.equal(r2[0].id, 'b')
})

test('classement : scénarios identiques => non départageables ; poids modifiables', () => {
  const x = simulate(square(0.5), base, dense)
  const r = rankScenarios([{ id: 'a', result: x, compensationPct: 0 }, { id: 'b', result: x, compensationPct: 0 }])
  assert.deepEqual(r[0].tiedWith, ['b'])
  const hi = { ...x, threatenedAffected: 50 }, lo = { ...x, speciesAffected: x.speciesAffected + 500 }
  const w0 = { threatened: 1, nearThreatened: 0, richness: 0, lowEffort: 0, fragmentation: 0, compensation: 0 }
  assert.equal(rankScenarios([{ id: 'hi', result: hi, compensationPct: 0 }, { id: 'lo', result: lo, compensationPct: 0 }], w0)[0].id, 'lo')
  assert.equal(rankScenarios([{ id: 'hi', result: hi, compensationPct: 0 }, { id: 'lo', result: lo, compensationPct: 0 }], { ...w0, threatened: 0, richness: 1 })[0].id, 'hi')
})
