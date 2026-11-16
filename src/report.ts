import { MODEL, PRESETS } from './engine/config.ts'
import { GROUP_IDS } from './engine/types.ts'
import type { SimulationResult } from './engine/types.ts'
import { CRITERIA } from './components/Compare.tsx'
import { BASELINE_ID, colorOf } from './scenarios.ts'
import type { Scenario } from './scenarios.ts'
import { CONF_FR, GROUP_FR, LEVEL_FR, fmt } from './labels.ts'
import type { Meta } from './data.ts'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export function buildReportHtml(scenarios: Scenario[], results: Record<string, SimulationResult | null>, meta: Meta): string {
  const rows = scenarios.filter((s) => results[s.id])
  const projects = rows.filter((s) => s.id !== BASELINE_ID)
  const th = rows.map((s) => `<th><span class="d" style="background:${colorOf(scenarios, s.id)}"></span>${esc(s.name)}</th>`).join('')
  const crit = CRITERIA.map((c) => {
    const vals = projects.map((s) => c.get(results[s.id]!, s)); const best = Math.min(...vals)
    const canBest = c.key !== 'ha' && c.key !== 'comp' && projects.length > 1
    return `<tr><th>${esc(c.label)}</th>${rows.map((s) => { const v = c.get(results[s.id]!, s); return `<td class="${canBest && s.id !== BASELINE_ID && v === best ? 'best' : ''}">${fmt(v, c.decimals ?? 1)}</td>` }).join('')}</tr>`
  }).join('')
  const extra = `<tr><th>Niveau d'impact</th>${rows.map((s) => `<td>${s.id === BASELINE_ID ? '–' : LEVEL_FR[results[s.id]!.level]}</td>`).join('')}</tr><tr><th>Confiance</th>${rows.map((s) => `<td>${s.id === BASELINE_ID ? '–' : CONF_FR[results[s.id]!.confidence.level]}</td>`).join('')}</tr>`
  const bars = GROUP_IDS.map((g) => `<tr><th>${GROUP_FR[g]}</th><td>${projects.map((s) => { const v = results[s.id]!.byGroup[g].score; return `<div class="bar"><i style="width:${Math.max(1, v)}%;background:${colorOf(scenarios, s.id)}"></i><span>${fmt(v)}</span></div>` }).join('')}</td></tr>`).join('')
  const legend = projects.map((s) => `<span class="lg"><span class="d" style="background:${colorOf(scenarios, s.id)}"></span>${esc(s.name)} (${PRESETS[s.params.preset].label}, phase ${s.params.phase === 'construction' ? 'chantier' : 'exploitation'}, rayon ${s.params.radiusM} m)</span>`).join(' ')
  const warn = [...new Set(projects.flatMap((s) => results[s.id]!.warnings))].map((w) => `<li>${esc(w)}</li>`).join('')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport de comparaison – Digital Twin Biodiversité Luxembourg</title><style>
body{font:14px/1.45 system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1a1a1a}h1{font-size:22px}h2{margin-top:28px;font-size:17px;border-bottom:1px solid #ccc}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;vertical-align:top}thead th{background:#eee}td.best{background:#d8f0dc;font-weight:700}
.banner{background:#fff3cd;border:1px solid #b58900;padding:8px 12px;font-weight:600}.d{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px}.lg{margin-right:14px;white-space:nowrap}
.bar{position:relative;height:16px;margin:2px 0;background:#f1f1f1}.bar i{display:block;height:100%}.bar span{position:absolute;left:6px;top:0;font-size:12px}
@media print{.noprint{display:none}}</style></head><body>
<button class="noprint" onclick="window.print()">Imprimer / enregistrer en PDF</button>
<h1>Digital Twin Biodiversité Luxembourg – Rapport de comparaison</h1><p>Généré le ${new Date().toLocaleString('fr-FR')}</p>
<p class="banner">Aide à la décision, ne remplace pas une étude d'impact. Indice heuristique, non prédictif.</p>
<h2>Comparaison chiffrée</h2><table><thead><tr><th>Critère</th>${th}</tr></thead><tbody>${crit}${extra}</tbody></table><p>Vert = scénario le moins impactant du critère (hors « sans projet »).</p>
<h2>Score d'impact par groupe taxonomique (0-100)</h2><p>${legend}</p><table><tbody>${bars}</tbody></table>
<h2>Avertissements sur les données</h2><ul>${warn || '<li>Aucun avertissement spécifique.</li>'}</ul>
<h2>Hypothèses du modèle</h2><ul>
<li>Valeur d'une cellule (~1 km²) = ${MODEL.weightRichness} × richesse + ${MODEL.weightThreatened} × espèces menacées (normalisées au percentile ${MODEL.referencePercentile * 100}).</li>
<li>Impact direct = coefficient du projet × phase × part de cellule recouverte × valeur ; indirect = idem avec le coefficient indirect et une décroissance (1 − d/R)^${MODEL.decayExponent} sur ${MODEL.rings} anneaux.</li>
<li>Compensation : réduit uniquement l'impact direct (% restauré × efficacité du preset) ; le gain écologique n'est pas modélisé.</li>
<li>Score = 100 × (1 − exp(−indice/${MODEL.saturation})). Coefficients : jugement d'expert, non calibrés (src/engine/config.ts).</li>
<li>Données : ${meta.years[0]}–${meta.years[1]}, effort d'observation inégal, statuts IUCN partiels (espèces menacées = minimum), pas de groupes mammifères/reptiles/poissons séparés.</li></ul>
<h2>Sources et licences</h2><ul>${meta.sources.map((s) => `<li>${esc(s.name)} – ${esc(s.license)} – ${esc(s.url)} (data.public.lu)</li>`).join('')}</ul>
</body></html>`
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function openReport(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  window.open(url, '_blank')
}
