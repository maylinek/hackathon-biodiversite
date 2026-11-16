import { useMemo, useState } from 'react'
import type { BiodiversityData, GroupId, SimulationResult } from '../engine/types.ts'
import { GROUP_IDS } from '../engine/types.ts'
import { CONF_FR, GROUP_FR, LEVEL_FR, fmt, iucnLabel } from '../labels.ts'
import type { Scenario } from '../scenarios.ts'
import { PRESETS } from '../engine/config.ts'

export default function ResultSheet({ scenario, result, data, showImpactMap }: { scenario: Scenario; result: SimulationResult | null; data: BiodiversityData; showImpactMap: () => void }) {
  const [q, setQ] = useState(''); const [g, setG] = useState<GroupId | ''>(''); const [st, setSt] = useState(''); const [ex, setEx] = useState('')
  const list = useMemo(() => {
    if (!result) return []
    const ql = q.trim().toLowerCase()
    return result.species.map((s) => ({ ...data.species[s.id], exposure: s.exposure })).filter((s) =>
      (!g || s.group === g) && (!ex || s.exposure === ex) && (!ql || s.name.toLowerCase().includes(ql)) &&
      (!st || (st === 'threat' ? (s.iucn ?? 0) >= 3 : st === 'nt' ? s.iucn === 2 : st === 'prot' ? s.protected : s.iucn === null))
    ).sort((a, b) => (b.iucn ?? -1) - (a.iucn ?? -1) || a.name.localeCompare(b.name))
  }, [result, data, q, g, st, ex])
  if (!result) return <p className="empty">« {scenario.name} » n'a pas de zone définie.</p>
  return (
    <section aria-labelledby="fiche-h">
      <h2 id="fiche-h">Fiche de résultats : {scenario.name}</h2>
      <div className="kpis">
        <div className="kpi"><span>Score</span><b>{fmt(result.score)}</b><small>{scenario.id === 'baseline' ? 'sans projet' : `niveau ${LEVEL_FR[result.level]}`}</small></div>
        <div className="kpi"><span>Confiance</span><b>{CONF_FR[result.confidence.level]}</b><small>médiane {fmt(result.confidence.weightedMedianObs, 0)} obs./cellule</small></div>
        <div className="kpi"><span>Espèces affectées</span><b>{result.speciesAffected}</b><small>dont {result.threatenedAffected} menacées (min.)</small></div>
        <div className="kpi"><span>Emprise</span><b>{fmt(result.footprintHa)} ha</b><small>{PRESETS[scenario.params.preset].label}{result.lengthKm ? `, ${fmt(result.lengthKm)} km` : ''}</small></div>
      </div>
      <button onClick={showImpactMap}>Voir la carte d'impact</button>
      {result.warnings.length > 0 && <ul className="warnings" aria-label="Avertissements sur la qualité des données">{result.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
      <h3>Espèces concernées ({list.length} / {result.species.length})</h3>
      <div className="filters">
        <input placeholder="Filtrer par nom scientifique" aria-label="Filtrer par nom scientifique" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Groupe" value={g} onChange={(e) => setG(e.target.value as GroupId | '')}><option value="">Tous groupes</option>{GROUP_IDS.map((x) => <option key={x} value={x}>{GROUP_FR[x]}</option>)}</select>
        <select aria-label="Statut" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Tous statuts</option><option value="threat">Menacées (VU/EN/CR)</option><option value="nt">Quasi menacées</option><option value="prot">Protégées</option><option value="none">Statut non renseigné</option></select>
        <select aria-label="Exposition" value={ex} onChange={(e) => setEx(e.target.value)}><option value="">Directe + indirecte</option><option value="direct">Directe</option><option value="indirect">Indirecte</option></select>
      </div>
      <div className="tablewrap tall"><table>
        <thead><tr><th>Nom scientifique</th><th>Groupe</th><th>Statut (IUCN / Luxembourg)</th><th>Exposition</th></tr></thead>
        <tbody>{list.slice(0, 300).map((s) => <tr key={s.name}><td><i>{s.name}</i></td><td>{GROUP_FR[s.group]}</td><td>{iucnLabel(s.iucn)}{s.protected ? ' · protégée' : ''}</td><td>{s.exposure === 'direct' ? 'Directe' : 'Indirecte'}</td></tr>)}</tbody>
      </table>{list.length > 300 && <p className="legend-note">300 premières lignes affichées sur {list.length} : affinez le filtre.</p>}</div>
    </section>
  )
}
