import { Bar, BarChart, CartesianGrid, Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { GROUP_IDS } from '../engine/types.ts'
import type { SimulationResult } from '../engine/types.ts'
import { BASELINE_ID, colorOf } from '../scenarios.ts'
import type { Scenario } from '../scenarios.ts'
import { CONF_FR, GROUP_FR, LEVEL_FR, fmt } from '../labels.ts'
import { PRESETS } from '../engine/config.ts'
import { Tip } from './ui.tsx'

export interface Criterion { key: string; label: string; tip?: string; get: (r: SimulationResult, s: Scenario) => number; show?: (r: SimulationResult, s: Scenario) => string; decimals?: number }
export const CRITERIA: Criterion[] = [
  { key: 'score', label: 'Score global (0-100)', tip: 'Indice heuristique d\'impact potentiel. Plus bas = moins d\'impact.', get: (r) => r.score },
  { key: 'direct', label: 'Impact direct (indice)', tip: 'Valeur de biodiversité des cellules recouvertes par l\'emprise, après compensation.', get: (r) => r.directIndex, decimals: 2 },
  { key: 'indirect', label: 'Impact indirect (indice)', tip: 'Valeur des cellules dans le rayon d\'influence, pondérée par la distance.', get: (r) => r.indirectIndex, decimals: 2 },
  { key: 'species', label: 'Espèces potentiellement affectées', tip: 'Espèces observées dans au moins une cellule touchée. Présence dans la cellule ≠ présence dans l\'emprise.', get: (r) => r.speciesAffected, decimals: 0 },
  { key: 'threat', label: 'dont menacées (IUCN VU/EN/CR, minimum)', tip: 'Minimum : la majorité des espèces n\'ont pas de statut dans les données.', get: (r) => r.threatenedAffected, decimals: 0 },
  { key: 'ha', label: 'Emprise (ha)', get: (r) => r.footprintHa, decimals: 1 },
  { key: 'comp', label: 'Compensation (% emprise restaurée)', get: (_r, s) => s.params.compensationPct, decimals: 0 },
]

interface Props { scenarios: Scenario[]; results: Record<string, SimulationResult | null>; refId: string; setRefId: (id: string) => void }

export default function Compare({ scenarios, results, refId, setRefId }: Props) {
  const rows = scenarios.filter((s) => results[s.id])
  const projects = rows.filter((s) => s.id !== BASELINE_ID)
  const ref = rows.find((s) => s.id === refId) ?? projects[0] ?? rows[0]
  if (!projects.length) return <p className="empty">Dessinez une zone et définissez un projet pour comparer des scénarios.</p>
  const best = (c: Criterion) => { const vals = projects.map((s) => c.get(results[s.id]!, s)); return Math.min(...vals) }
  const bestable = (c: Criterion) => c.key !== 'ha' && c.key !== 'comp'
  const groupData = GROUP_IDS.map((g) => ({ group: GROUP_FR[g], ...Object.fromEntries(rows.map((s) => [s.id, results[s.id]!.byGroup[g].score])) }))
  const nm = (id: string) => scenarios.find((s) => s.id === id)?.name ?? id
  return (
    <section aria-labelledby="cmp-h">
      <h2 id="cmp-h">Comparaison des scénarios</h2>
      <div className="row">
        <label>Écarts calculés par rapport à : <select value={ref?.id} onChange={(e) => setRefId(e.target.value)}>{rows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <span className="legend-note"><span className="best">vert</span> = scénario le moins impactant du critère (hors « sans projet »)</span>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Critère</th>{rows.map((s) => <th key={s.id}><span className="dot" style={{ background: colorOf(scenarios, s.id) }} />{s.name}</th>)}</tr></thead>
        <tbody>
          {CRITERIA.map((c) => (
            <tr key={c.key}>
              <th scope="row">{c.label}{c.tip && <Tip text={c.tip} />}</th>
              {rows.map((s) => {
                const r = results[s.id]!; const v = c.get(r, s); const rv = ref ? c.get(results[ref.id]!, ref) : v
                const isBest = bestable(c) && s.id !== BASELINE_ID && projects.length > 1 && v === best(c)
                const d = v - rv
                return <td key={s.id} className={isBest ? 'best' : ''}>
                  <b>{fmt(v, c.decimals ?? 1)}</b>
                  {s.id !== ref?.id && (d !== 0 ? <small> ({d > 0 ? '+' : ''}{fmt(d, c.decimals ?? 1)}{rv !== 0 ? `, ${d > 0 ? '+' : ''}${fmt((d / rv) * 100, 0)} %` : ''})</small> : <small> (=)</small>)}
                </td>
              })}
            </tr>
          ))}
          <tr><th scope="row">Niveau d'impact</th>{rows.map((s) => <td key={s.id}>{s.id === BASELINE_ID ? '–' : LEVEL_FR[results[s.id]!.level]}</td>)}</tr>
          <tr><th scope="row">Confiance<Tip text="Selon le nombre d'observations par cellule touchée. Faible confiance = absence de données plutôt qu'absence d'enjeu." /></th>{rows.map((s) => <td key={s.id}>{s.id === BASELINE_ID ? '–' : CONF_FR[results[s.id]!.confidence.level]}</td>)}</tr>
        </tbody>
      </table></div>
      <div className="charts">
        <figure>
          <figcaption>Score d'impact par groupe taxonomique (0-100)</figcaption>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={groupData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="group" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} /><YAxis domain={[0, 100]} /><Tooltip formatter={(v, k) => [fmt(Number(v)), nm(String(k))]} /><Legend formatter={(v) => nm(String(v))} />
              {rows.filter((s) => s.id !== BASELINE_ID).map((s) => <Bar key={s.id} dataKey={s.id} fill={colorOf(scenarios, s.id)} />)}
            </BarChart>
          </ResponsiveContainer>
        </figure>
        <figure>
          <figcaption>Profil d'impact (radar)</figcaption>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={groupData}><PolarGrid /><PolarAngleAxis dataKey="group" tick={{ fontSize: 11 }} /><PolarRadiusAxis domain={[0, 100]} /><Tooltip formatter={(v, k) => [fmt(Number(v)), nm(String(k))]} /><Legend formatter={(v) => nm(String(v))} />
              {rows.filter((s) => s.id !== BASELINE_ID).map((s) => <Radar key={s.id} dataKey={s.id} stroke={colorOf(scenarios, s.id)} fill={colorOf(scenarios, s.id)} fillOpacity={0.15} />)}
            </RadarChart>
          </ResponsiveContainer>
        </figure>
      </div>
      <p className="legend-note">Presets : {projects.map((s) => `${s.name} = ${PRESETS[s.params.preset].label}`).join(' ; ')}.</p>
    </section>
  )
}
