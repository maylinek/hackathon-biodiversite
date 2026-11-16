import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SpeciesInfo } from '../engine/types.ts'
import { GROUP_FR, IUCN_FR } from '../labels.ts'
import { fmtDate, placeOf, speciesHistory } from '../observations.ts'
import type { ObsStore } from '../observations.ts'

const NR = 'non renseigné'
export default function SpeciesSheet({ id, sp, obs, highlight, onClose }: { id: number; sp: SpeciesInfo; obs: ObsStore; highlight: number | null; onClose: () => void }) {
  const h = useMemo(() => speciesHistory(obs, id), [obs, id])
  const status = sp.iucn === null ? 'Non évalué (statut IUCN non renseigné dans les données)' : IUCN_FR[String(sp.iucn)]
  return (
    <section className="card species" aria-labelledby="sp-h">
      <button className="close-btn" onClick={onClose} aria-label="Fermer la fiche">✕</button>
      <h2 id="sp-h"><i>{sp.name}</i></h2>
      <dl>
        <dt>Groupe</dt><dd>{GROUP_FR[sp.group]}</dd>
        <dt>Statut IUCN</dt><dd>{status}</dd>
        <dt>Protection</dt><dd>{sp.protected ? 'Protégée au Luxembourg (selon les données)' : `${NR} (aucune protection indiquée dans les données)`}</dd>
        <dt>Observations</dt><dd>{h.count.toLocaleString('fr-FR')}</dd>
        <dt>Période couverte</dt><dd>{h.first ? (h.first === h.last ? h.first : `${h.first} – ${h.last}`) : NR}</dd>
        <dt>Jeux de données</dt><dd><ul>{h.datasets.map((d) => <li key={d.name}>{d.name || NR} ({d.n})</li>)}</ul></dd>
      </dl>
      <h3>Observations par année</h3>
      {h.byYear.length ? <div role="img" aria-label={`Observations par année, de ${h.first} à ${h.last}`}><ResponsiveContainer width="100%" height={130}>
        <BarChart data={h.byYear} margin={{ left: -20, right: 4, top: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="year" tick={{ fontSize: 10 }} minTickGap={16} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip formatter={(v) => [v, 'observations']} labelFormatter={(l) => `Année ${l}`} /><Bar dataKey="n" fill="#1f5a46" /></BarChart>
      </ResponsiveContainer></div> : <p className="hint">Dates {NR}.</p>}
      <h3>Dernières observations</h3>
      <ul className="latest">{h.latest.map((o) => <li key={o.i} className={o.i === highlight ? 'hl' : ''}><b>{fmtDate(o.date)}</b> · {placeOf(obs, o.i)}<small>{obs.datasets[obs.ds[o.i]]}</small></li>)}</ul>
      <p className="hint">Photo et description : non disponibles (aucune source externe appelée). Données MNHNL, CC0.</p>
    </section>
  )
}
