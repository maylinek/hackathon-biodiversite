import type { ConfidenceLevel, GroupId, ImpactLevel } from './engine/types.ts'
export const LEVEL_FR: Record<ImpactLevel, string> = { low: 'Faible', moderate: 'Modéré', high: 'Élevé', veryHigh: 'Très élevé' }
export const CONF_FR: Record<ConfidenceLevel, string> = { none: 'Nulle (aucune donnée)', low: 'Faible', medium: 'Moyenne', high: 'Haute' }
export const GROUP_FR: Record<GroupId, string> = { bird: 'Oiseaux', vert: 'Autres vertébrés', plant: 'Plantes', fung: 'Champignons', arth: 'Arthropodes (insectes…)', other: 'Autres' }
export const IUCN_FR: Record<string, string> = { '0': 'Non évalué / données insuffisantes', '1': 'Préoccupation mineure', '2': 'Quasi menacée', '3': 'Vulnérable', '4': 'En danger', '5': 'En danger critique' }
export const iucnLabel = (v: number | null) => (v === null ? 'Statut non renseigné' : IUCN_FR[String(v)])
export const fmt = (n: number, d = 1) => n.toLocaleString('fr-FR', { maximumFractionDigits: d })
