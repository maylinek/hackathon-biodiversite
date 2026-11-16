import { RANKING } from '../engine/config.ts'
import { CRITERION_LABELS } from '../engine/ranking.ts'
import type { CriterionKey, RankedItem, Weights } from '../engine/ranking.ts'
import { fmt } from '../labels.ts'
import type { BiodiversityData, SimulationResult } from '../engine/types.ts'
import type { Scenario } from '../scenarios.ts'
import { colorOf } from '../scenarios.ts'

export const fmtInd = (k: CriterionKey, v: number) => (k === 'lowEffort' ? `${fmt(v * 100, 0)} %` : k === 'compensation' ? `${fmt((1 - v) * 100, 0)} % compensé` : k === 'fragmentation' ? `${fmt(v, 1)} km` : fmt(v, 0))

export default function Ranking({ scenarios, ranking, weights, setWeights, results, data }: { scenarios: Scenario[]; ranking: RankedItem[]; weights: Weights; setWeights: (w: Weights) => void; results: Record<string, SimulationResult | null>; data: BiodiversityData }) {
  const nm = (id: string) => scenarios.find((s) => s.id === id)?.name ?? id
  const keys = Object.keys(weights) as CriterionKey[]
  const sum = keys.reduce((a, k) => a + weights[k], 0) || 1
  const best = ranking.find((r) => r.best)
  return (
    <section aria-labelledby="rk-h">
      <h2 id="rk-h">Classement des scénarios</h2>
      {ranking.length < 2 ? <p className="empty">Au moins deux scénarios avec zone sont nécessaires pour désigner le meilleur.</p> : <>
        <p className="verdict" role="status">Meilleur scénario pour la préservation de la biodiversité (selon ces indicateurs et ces poids) : <b>{best ? nm(best.id) : '–'}</b>.
          {best && best.tiedWith.length > 0 && <> <span className="warn-inline">Attention : écart insuffisant avec {best.tiedWith.map(nm).join(', ')} au regard de l'incertitude, ils ne sont pas départageables.</span></>}</p>
        <ol className="rank">{ranking.map((r) => <li key={r.id}><span className="dot" style={{ background: colorOf(scenarios, r.id) }} /><b>{r.rank}. {nm(r.id)}</b> — score composite {fmt(r.composite * 100, 0)}/100 (plus bas = mieux){r.tiedWith.length > 0 && <em> · non départageable de : {r.tiedWith.map(nm).join(', ')}</em>}</li>)}</ol>
      </>}
      {ranking.length > 0 && <div className="tablewrap"><table>
        <caption className="sr">Indicateurs par scénario</caption>
        <thead><tr><th>Indicateur</th>{ranking.map((r) => <th key={r.id}>{nm(r.id)}</th>)}</tr></thead>
        <tbody>{keys.map((k) => <tr key={k}><th scope="row">{CRITERION_LABELS[k]}</th>{ranking.map((r) => <td key={r.id}>{fmtInd(k, r.indicators[k])}</td>)}</tr>)}</tbody>
      </table></div>}
      {ranking.map((r) => { const sp = (results[r.id]?.species ?? []).map((x) => ({ ...data.species[x.id], ex: x.exposure })).filter((x) => (x.iucn ?? 0) >= 2).sort((a, b) => (b.iucn ?? 0) - (a.iucn ?? 0) || a.name.localeCompare(b.name))
        return <details key={r.id}><summary>Espèces menacées et quasi menacées touchées : {nm(r.id)} ({sp.length})</summary>
          {sp.length ? <ul className="spl">{sp.map((x) => <li key={x.name}><i>{x.name}</i> — {x.iucn! >= 3 ? 'menacée' : 'quasi menacée'}, exposition {x.ex === 'direct' ? 'directe' : 'indirecte'}</li>)}</ul> : <p className="hint">Aucune dans les données (ne prouve pas leur absence).</p>}</details> })}
      <details>
        <summary>Pondération des indicateurs (modifiable)</summary>
        <div className="weights">{keys.map((k) => <label key={k} className="field"><span className="flabel">{CRITERION_LABELS[k]} : {fmt((weights[k] / sum) * 100, 0)} %</span>
          <input type="range" min={0} max={100} step={5} value={Math.round(weights[k] * 100)} onChange={(e) => setWeights({ ...weights, [k]: +e.target.value / 100 })} /></label>)}
        </div>
        <button onClick={() => setWeights({ ...RANKING.defaultWeights })}>Rétablir les poids par défaut</button>
        <p className="hint">Chaque indicateur est ramené à 0–1 (valeur ÷ maximum des scénarios testés), puis pondéré. Les poids sont des hypothèses, pas des valeurs scientifiques.</p>
      </details>
    </section>
  )
}
