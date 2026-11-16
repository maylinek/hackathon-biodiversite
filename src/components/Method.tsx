import { MODEL, PRESETS } from '../engine/config.ts'
import { GROUP_FR } from '../labels.ts'
import { RANKING } from '../engine/config.ts'
import { CRITERION_LABELS } from '../engine/ranking.ts'
import type { CriterionKey } from '../engine/ranking.ts'
import { ECOPOINTS_NOTE } from '../report.ts'
import type { Meta } from '../data.ts'

export default function Method({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const s = meta.stats
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="meth-h">
      <div className="modal-box">
        <button className="close" onClick={onClose} aria-label="Fermer">✕</button>
        <h2 id="meth-h">Méthode et limites</h2>
        <p><b>Aide à la décision, ne remplace pas une étude d'impact.</b> Le score est un indice heuristique explicable, pas une prédiction scientifique.</p>
        <h3>Hypothèses du modèle</h3>
        <ol>
          <li><b>Valeur d'une cellule (~1 km²)</b> = {MODEL.weightRichness} × richesse spécifique + {MODEL.weightThreatened} × espèces menacées, chacune plafonnée à 1 au percentile {MODEL.referencePercentile * 100} national.</li>
          <li><b>Impact direct</b> = coefficient du type de projet × coefficient de phase × part de la cellule recouverte par l'emprise × valeur de la cellule.</li>
          <li><b>Impact indirect</b> : la zone d'influence est découpée en {MODEL.rings} anneaux ; le poids de chacun vaut (1 − d/R)<sup>{MODEL.decayExponent}</sup> (d = distance au milieu de l'anneau, R = rayon), multiplié par la part de cellule concernée, le coefficient indirect, le coefficient de phase et la valeur de la cellule.</li>
          <li><b>Compensation</b> : réduit uniquement l'impact direct, de (% restauré × efficacité du preset). Jamais à 100 % d'efficacité : une restauration ne remplace pas un habitat existant. Le gain écologique n'est pas modélisé.</li>
          <li><b>Score global</b> = 100 × (1 − exp(−indice / {MODEL.saturation})) : saturation douce, 0 = aucun impact. Niveaux : faible &lt; {MODEL.levels.moderate}, modéré &lt; {MODEL.levels.high}, élevé &lt; {MODEL.levels.veryHigh}, très élevé au-delà.</li>
          <li><b>Scores par groupe</b> : même formule, avec la richesse du groupe normalisée et une sensibilité propre au type de projet.</li>
          <li><b>Espèces « potentiellement affectées »</b> : toutes celles observées (toutes années confondues) dans les cellules touchées, directement ou dans le rayon. Une espèce présente dans la cellule peut être absente de l'emprise exacte.</li>
          <li><b>Confiance</b> : médiane pondérée du nombre d'observations des cellules touchées (haute ≥ {MODEL.confidence.highMedianObs}, faible &lt; {MODEL.confidence.lowMedianObs} ou plus de {MODEL.confidence.lowShareLow * 100} % de l'influence sur des cellules &lt; {MODEL.confidence.lowObs} obs.).</li>
          <li>Les coefficients ci-dessous sont des <b>hypothèses de jugement d'expert, non calibrées</b>. Ils se modifient dans <code>src/engine/config.ts</code>.</li>
        </ol>
        <div className="tablewrap"><table>
          <thead><tr><th>Preset</th><th>Direct</th><th>Indirect</th><th>Chantier (d/i)</th><th>Exploit. (d/i)</th><th>Efficacité compensation</th><th>Rayon défaut</th><th>Sensibilités ≠ 1</th></tr></thead>
          <tbody>{Object.values(PRESETS).map((p) => <tr key={p.label}><th scope="row" title={p.help}>{p.label}</th><td>{p.directCoef}</td><td>{p.indirectCoef}</td><td>{p.phase.construction.direct}/{p.phase.construction.indirect}</td><td>{p.phase.operation.direct}/{p.phase.operation.indirect}</td><td>{p.compensationEfficiency}</td><td>{p.defaultRadiusM} m</td><td>{Object.entries(p.groupSensitivity).filter(([, v]) => v !== 1).map(([g, v]) => `${GROUP_FR[g as keyof typeof GROUP_FR]} ×${v}`).join(', ') || '–'}</td></tr>)}</tbody>
        </table></div>
        <h3>Classement des scénarios</h3>
        <ol>
          <li>Indicateurs calculés uniquement sur les données du dépôt, pour les cellules de 1 km touchées : espèces menacées (IUCN VU/EN/CR), quasi menacées, richesse spécifique, part de l'influence sur des cellules à faible effort d'observation (incertitude), longueur de linéaire en zone observée (proxy de fragmentation, 0 pour une emprise non linéaire), part non compensée.</li>
          <li>Chaque indicateur ÷ son maximum parmi les scénarios, puis somme pondérée (poids par défaut : {(Object.keys(RANKING.defaultWeights) as CriterionKey[]).map((k) => `${CRITERION_LABELS[k]} ${RANKING.defaultWeights[k] * 100} %`).join(' ; ')}). Poids modifiables dans l'onglet Classement ; ce sont des hypothèses.</li>
          <li>Non départageables si l'écart composite &lt; {RANKING.tieBase} + {RANKING.tieUncertainty} × part moyenne de surface à faible effort des deux scénarios.</li>
        </ol>
        <h3>Barème écopoints</h3>
        <p>{ECOPOINTS_NOTE}</p>
        <h3>Limites des données</h3>
        <ul>
          <li>Sources : {meta.sources.map((x) => x.name).join(' ; ')}. {s.conservees?.toLocaleString('fr-FR')} observations conservées sur {s.lues?.toLocaleString('fr-FR')} lues ({s.rejet_doublon?.toLocaleString('fr-FR')} doublons, {s.rejet_hors_luxembourg?.toLocaleString('fr-FR')} hors Luxembourg, {s.rejet_nom_non_binomial?.toLocaleString('fr-FR')} sans nom d'espèce).</li>
          <li>Observations de {meta.years[0]} à {meta.years[1]}, toutes années confondues : pas de pondération temporelle, des espèces anciennes peuvent avoir disparu.</li>
          <li>Effort d'observation très inégal : l'absence d'observation n'est pas l'absence d'espèce. Les cellules sans donnée n'apparaissent pas sur la carte.</li>
          <li>Statut de conservation (IUCN, tel que fourni par le MNHNL) renseigné pour une minorité d'espèces : « menacées » est un minimum.</li>
          <li>Pas de classe/ordre dans les données : mammifères, reptiles, amphibiens et poissons sont regroupés en « Autres vertébrés » ; les insectes ne sont pas séparés des autres arthropodes.</li>
          <li>Grille en degrés (~1 km) ; aucun habitat, relief, cours d'eau, ni zone protégée n'est pris en compte.</li>
          <li>Le jeu « GBIF Luxembourg » n'est pas intégré (aucun fichier téléchargeable ; licence « Other (Open) » à vérifier).</li>
        </ul>
      </div>
    </div>
  )
}
