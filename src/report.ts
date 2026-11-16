import { MODEL, PRESETS, RANKING } from './engine/config.ts'
import { CRITERION_LABELS } from './engine/ranking.ts'
import type { CriterionKey, RankedItem, Weights } from './engine/ranking.ts'
import { GROUP_IDS } from './engine/types.ts'
import type { BiodiversityData, SimulationResult } from './engine/types.ts'
import { BASELINE_ID, colorOf } from './scenarios.ts'
import type { Scenario } from './scenarios.ts'
import { CONF_FR, GROUP_FR, LEVEL_FR, fmt } from './labels.ts'
import { fmtInd } from './components/Ranking.tsx'
import type { Meta } from './data.ts'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
export const ECOPOINTS_NOTE = `Le barème luxembourgeois de compensation en éco-points n'est PAS appliqué. Le cadre existe (règlement grand-ducal du 1er août 2018 instituant un système numérique d'évaluation et de compensation en éco-points, modifié en 2024 ; guide du ministère de l'Environnement : https://environnement.public.lu/content/dam/environnement/documents/natur/biodiversite/compensation/guide-calcul-ecopoints-04-2024.pdf), mais il évalue des types de biotopes/habitats cartographiés. Les données du dépôt (observations d'espèces sur grille de 1 km) ne contiennent aucune cartographie de biotopes : le barème ne peut pas être appliqué sans inventer des correspondances. Aucune valeur n'a été reprise de mémoire. Pour une compensation réglementaire, l'évaluation en éco-points doit être faite par un bureau d'études avec les données de biotopes.`

export interface ReportInput {
  scenarios: Scenario[]; results: Record<string, SimulationResult | null>; ranking: RankedItem[]; weights: Weights
  data: BiodiversityData; meta: Meta
}

export function buildReportHtml({ scenarios, results, ranking, weights, data, meta }: ReportInput): string {
  const projects = scenarios.filter((s) => s.id !== BASELINE_ID && results[s.id])
  const nm = (id: string) => esc(scenarios.find((s) => s.id === id)?.name ?? id)
  const keys = Object.keys(weights) as CriterionKey[]
  const wsum = keys.reduce((a, k) => a + weights[k], 0) || 1
  const best = ranking.find((r) => r.best)
  const verdict = ranking.length < 2
    ? '<p class="banner">Moins de deux scénarios testés : aucun classement possible.</p>'
    : `<p class="verdict">Meilleur scénario pour la préservation de la biodiversité (selon les indicateurs et poids ci-dessous) : <b>${best ? nm(best.id) : '–'}</b>.${best && best.tiedWith.length ? ` <span class="warn">Écart insuffisant avec ${best.tiedWith.map(nm).join(', ')} au regard de l'incertitude : scénarios non départageables.</span>` : ''}</p>`
  const rankRows = ranking.map((r) => `<tr class="${r.best ? 'best' : ''}"><td>${r.rank}</td><td><span class="d" style="background:${colorOf(scenarios, r.id)}"></span>${nm(r.id)}</td><td>${fmt(r.composite * 100, 0)}</td><td>${r.tiedWith.length ? 'non départageable de : ' + r.tiedWith.map(nm).join(', ') : 'départagé'}</td></tr>`).join('')
  const indRows = keys.map((k) => `<tr><th>${esc(CRITERION_LABELS[k])}</th>${ranking.map((r) => `<td>${fmtInd(k, r.indicators[k])}</td>`).join('')}</tr>`).join('')
  const wRows = keys.map((k) => `<li>${esc(CRITERION_LABELS[k])} : ${fmt((weights[k] / wsum) * 100, 0)} %</li>`).join('')
  const spl = projects.map((s) => {
    const l = results[s.id]!.species.map((x) => ({ ...data.species[x.id], ex: x.exposure })).filter((x) => (x.iucn ?? 0) >= 2).sort((a, b) => (b.iucn ?? 0) - (a.iucn ?? 0) || a.name.localeCompare(b.name))
    return `<h3>${nm(s.id)} (${l.length})</h3>${l.length ? `<ul class="cols">${l.map((x) => `<li><i>${esc(x.name)}</i> – ${x.iucn! >= 3 ? 'menacée' : 'quasi menacée'}, ${x.ex === 'direct' ? 'directe' : 'indirecte'}</li>`).join('')}</ul>` : '<p>Aucune dans les données (ce qui ne prouve pas leur absence).</p>'}`
  }).join('')
  const detail = projects.map((s) => { const r = results[s.id]!; return `<tr><th>${nm(s.id)}</th><td>${PRESETS[s.params.preset].label}, ${s.params.phase === 'construction' ? 'chantier' : 'exploitation'}, rayon ${s.params.radiusM} m</td><td>${fmt(r.footprintHa)} ha</td><td>${fmt(r.score)} (${LEVEL_FR[r.level]})</td><td>${CONF_FR[r.confidence.level]}</td></tr>` }).join('')
  const bars = GROUP_IDS.map((g) => `<tr><th>${GROUP_FR[g]}</th>${projects.map((s) => `<td>${fmt(results[s.id]!.byGroup[g].score)}</td>`).join('')}</tr>`).join('')
  const warn = [...new Set(projects.flatMap((s) => results[s.id]!.warnings))].map((w) => `<li>${esc(w)}</li>`).join('')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport de comparaison – Digital Twin Biodiversité Luxembourg</title><style>
body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1f2a22;background:#fbf8f1}h1{font-size:22px;color:#1f5a46}h2{margin-top:28px;font-size:17px;border-bottom:2px solid #c9d8c5;color:#1f5a46}
table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #c9c2b0;padding:5px 8px;text-align:left;vertical-align:top}thead th{background:#e3ecde}tr.best td{background:#dcebd6;font-weight:700}
.banner{background:#fff3cd;border:1px solid #8a6d00;padding:8px 12px;font-weight:600;border-radius:8px}.verdict{background:#dcebd6;border:1px solid #1f5a46;padding:10px 14px;border-radius:8px;font-size:15px}.warn{color:#7a2e00;font-weight:600}
.d{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px}.cols{columns:2}button{background:#1f5a46;color:#fff;border:0;padding:8px 14px;border-radius:8px;cursor:pointer}@media print{.noprint{display:none}body{background:#fff}}</style></head><body>
<button class="noprint" onclick="window.print()">Imprimer / enregistrer en PDF</button>
<h1>Digital Twin Biodiversité Luxembourg – Rapport de comparaison de scénarios</h1><p>Généré le ${new Date().toLocaleString('fr-FR')}</p>
<p class="banner">Aide à la décision, ne remplace pas une étude d'impact. Indicateurs calculés sur des observations, pas une prédiction.</p>
<h2>Résultat : classement des scénarios</h2>${verdict}
<table><thead><tr><th>Rang</th><th>Scénario</th><th>Score composite (0-100, bas = mieux)</th><th>Départage</th></tr></thead><tbody>${rankRows}</tbody></table>
<h2>Indicateurs par scénario</h2><table><thead><tr><th>Indicateur</th>${ranking.map((r) => `<th>${nm(r.id)}</th>`).join('')}</tr></thead><tbody>${indRows}</tbody></table>
<table style="margin-top:12px"><thead><tr><th>Scénario</th><th>Projet</th><th>Emprise</th><th>Score d'impact heuristique</th><th>Confiance</th></tr></thead><tbody>${detail}</tbody></table>
<h2>Espèces menacées (VU/EN/CR) et quasi menacées touchées</h2><p>Espèces observées, toutes années confondues, dans les cellules de 1 km touchées (directement ou dans le rayon d'influence). Présence dans la cellule ≠ présence dans l'emprise exacte.</p>${spl}
<h2>Score d'impact heuristique par groupe (0-100)</h2><table><thead><tr><th>Groupe</th>${projects.map((s) => `<th>${nm(s.id)}</th>`).join('')}</tr></thead><tbody>${bars}</tbody></table>
<h2>Méthode</h2><ol>
<li>Pour chaque scénario, le moteur (src/engine) détermine les cellules de 1 km touchées par l'emprise et par son rayon d'influence, puis en tire : nombre d'espèces menacées et quasi menacées, richesse spécifique, part de l'influence sur des cellules à moins de ${MODEL.confidence.lowObs} observations (incertitude), longueur de linéaire traversant des cellules observées (proxy de fragmentation, 0 si l'emprise n'est pas linéaire), compensation dessinée ou saisie.</li>
<li>Chaque indicateur est divisé par son maximum parmi les scénarios testés (0–1), puis pondéré. Score composite bas = scénario moins impactant. Poids utilisés (modifiables) :<ul>${wRows}</ul></li>
<li>Deux scénarios sont déclarés « non départageables » si l'écart de score composite est inférieur à ${RANKING.tieBase} + ${RANKING.tieUncertainty} × (part moyenne de surface à faible effort d'observation des deux scénarios).</li>
<li>Score d'impact heuristique (indicateur complémentaire) : valeur de cellule = ${MODEL.weightRichness} × richesse + ${MODEL.weightThreatened} × menacées (percentile ${MODEL.referencePercentile * 100}) ; coefficients par type de projet = jugement d'expert non calibré (src/engine/config.ts).</li></ol>
<h2>Hypothèses</h2><ul><li>Les poids par défaut et les coefficients sont des hypothèses de travail, non issues d'une calibration scientifique.</li><li>Une zone de compensation dessinée réduit l'impact direct selon (surface compensée ÷ emprise) × efficacité supposée du type de projet ; le gain écologique de la restauration n'est pas modélisé.</li><li>La fragmentation est mesurée sans donnée d'habitat : simple longueur de tracé en zone observée.</li></ul>
<h2>Limites et incertitudes</h2><ul>
<li><b>L'absence d'observation n'est pas une absence d'espèce</b> : l'effort d'observation est très inégal (cellules peu observées = forte incertitude, indicateur « surface à faible effort »).</li>
<li>Statuts IUCN renseignés pour une minorité d'espèces (2 332 sur 9 615) : « menacées » est un minimum ; les espèces sans statut sont « non évaluées », pas « non menacées ».</li>
<li>Observations de ${meta.years[0]} à ${meta.years[1]}, toutes années confondues : pas de pondération temporelle.</li>
<li>Groupes limités (mammifères, reptiles, amphibiens, poissons regroupés ; insectes non séparés des arthropodes). Grille de 1 km : l'emprise exacte n'est pas résolue.</li>
<li>Aucun habitat, relief, cours d'eau, zone protégée ni connectivité réelle n'est pris en compte. Le classement dépend des poids choisis.</li></ul>
${warn ? `<h3>Avertissements du calcul</h3><ul>${warn}</ul>` : ''}
<h2>Barème écopoints</h2><p>${esc(ECOPOINTS_NOTE)}</p>
<h2>Sources et licences</h2><ul>${meta.sources.map((s) => `<li>${esc(s.name)} – ${esc(s.license)} – ${esc(s.url)} (data.public.lu)</li>`).join('')}<li>Fond de carte © contributeurs OpenStreetMap, OpenFreeMap ; recherche de lieux : Nominatim © contributeurs OpenStreetMap (ODbL).</li></ul>
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
