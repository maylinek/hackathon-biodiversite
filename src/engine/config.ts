/**
 * COEFFICIENTS DU MODÈLE — fichier unique, modifiable.
 * Ce sont des hypothèses de jugement d'expert, NON calibrées scientifiquement.
 * L'indice qui en résulte est heuristique : il ne remplace pas une étude d'impact.
 */
import type { GroupId, Phase, PresetId } from './types.ts'

export interface PresetConfig {
  label: string
  linear: boolean // true : l'utilisateur dessine une ligne, emprise = ligne tamponnée de widthM
  defaultWidthM: number
  defaultRadiusM: number
  /** Part de la valeur biodiversité détruite/transformée dans l'emprise (0-1). */
  directCoef: number
  /** Part de la valeur perturbée au contact immédiat de l'emprise (bruit, lumière, fragmentation), décroît avec la distance. */
  indirectCoef: number
  /** Multiplicateurs par phase (sur direct, indirect). */
  phase: Record<Phase, { direct: number; indirect: number }>
  /** Efficacité de la compensation : part de l'impact direct évité quand 100 % de l'emprise est restaurée. */
  compensationEfficiency: number
  /** Sensibilité relative des groupes à ce type de projet (multiplicateur). */
  groupSensitivity: Record<GroupId, number>
  help: string
}

const flat: Record<GroupId, number> = { bird: 1, vert: 1, plant: 1, fung: 1, arth: 1, other: 1 }

export const PRESETS: Record<PresetId, PresetConfig> = {
  building: {
    label: 'Bâtiment', linear: false, defaultWidthM: 0, defaultRadiusM: 200,
    directCoef: 0.9, indirectCoef: 0.25,
    phase: { construction: { direct: 1, indirect: 1.2 }, operation: { direct: 1, indirect: 0.7 } },
    compensationEfficiency: 0.6,
    groupSensitivity: { ...flat, bird: 1.1, plant: 1.2 },
    help: 'Imperméabilisation quasi totale de l\'emprise ; perturbations locales (lumière, bruit).',
  },
  airport: {
    label: 'Aéroport', linear: false, defaultWidthM: 0, defaultRadiusM: 3000,
    directCoef: 0.85, indirectCoef: 0.4,
    phase: { construction: { direct: 1, indirect: 1.1 }, operation: { direct: 1, indirect: 1.3 } },
    compensationEfficiency: 0.5,
    groupSensitivity: { ...flat, bird: 1.5, vert: 1.2, arth: 1.1 },
    help: 'Grande emprise ; bruit et lumière étendus, collisions et dérangement des oiseaux.',
  },
  road: {
    label: 'Route', linear: true, defaultWidthM: 20, defaultRadiusM: 500,
    directCoef: 0.85, indirectCoef: 0.35,
    phase: { construction: { direct: 1, indirect: 1.2 }, operation: { direct: 1, indirect: 1 } },
    compensationEfficiency: 0.5,
    groupSensitivity: { ...flat, vert: 1.5, arth: 1.1, bird: 1.1 },
    help: 'Emprise étroite mais coupure (fragmentation), bruit et mortalité routière.',
  },
  rail: {
    label: 'Voie ferrée', linear: true, defaultWidthM: 15, defaultRadiusM: 300,
    directCoef: 0.8, indirectCoef: 0.3,
    phase: { construction: { direct: 1, indirect: 1.2 }, operation: { direct: 1, indirect: 0.8 } },
    compensationEfficiency: 0.5,
    groupSensitivity: { ...flat, vert: 1.3, arth: 1.0 },
    help: 'Coupure linéaire ; trafic plus discret qu\'une route, bruit ponctuel.',
  },
  activity: {
    label: "Zone d'activité", linear: false, defaultWidthM: 0, defaultRadiusM: 500,
    directCoef: 0.85, indirectCoef: 0.3,
    phase: { construction: { direct: 1, indirect: 1.2 }, operation: { direct: 1, indirect: 0.9 } },
    compensationEfficiency: 0.6,
    groupSensitivity: { ...flat, arth: 1.1, plant: 1.1 },
    help: 'Imperméabilisation importante, éclairage et trafic.',
  },
  solar: {
    label: 'Parc photovoltaïque', linear: false, defaultWidthM: 0, defaultRadiusM: 200,
    directCoef: 0.55, indirectCoef: 0.15,
    phase: { construction: { direct: 1, indirect: 1.3 }, operation: { direct: 0.6, indirect: 0.5 } },
    compensationEfficiency: 0.7,
    groupSensitivity: { ...flat, bird: 1.2, plant: 0.9 },
    help: 'Sol partiellement conservé en exploitation (si géré), mais habitat modifié ; pic de perturbation en chantier.',
  },
  restoration: {
    label: 'Restauration écologique', linear: false, defaultWidthM: 0, defaultRadiusM: 100,
    directCoef: 0.1, indirectCoef: 0.05,
    phase: { construction: { direct: 1, indirect: 1 }, operation: { direct: 0.1, indirect: 0.1 } },
    compensationEfficiency: 0.9,
    groupSensitivity: flat,
    help: 'Perturbation temporaire de chantier. Le MODÈLE NE CHIFFRE PAS le gain écologique (non modélisé).',
  },
}

export const MODEL = {
  /** Normalisation : la valeur d'une cellule est plafonnée à 1 au percentile suivant de la distribution nationale. */
  referencePercentile: 0.95,
  /** Poids de la richesse et des espèces menacées dans la valeur d'une cellule. */
  weightRichness: 0.6,
  weightThreatened: 0.4,
  /** Échelle de saturation : score = 100 × (1 − exp(−indice / saturation)). Indice exprimé en « cellules de forte valeur » équivalentes. */
  saturation: 8,
  /** Exposant de décroissance avec la distance : poids = (1 − d/R)^exposant. */
  decayExponent: 2,
  /** Nombre d'anneaux pour intégrer la décroissance. */
  rings: 3,
  /** Seuils de niveau d'impact (score). */
  levels: { moderate: 20, high: 45, veryHigh: 70 },
  /** Confiance : nb d'observations par cellule. */
  confidence: { lowObs: 5, highMedianObs: 30, lowMedianObs: 10, lowShareHigh: 0.1, lowShareLow: 0.4 },
}

/**
 * Classement des scénarios (indicateurs calculés sur les données du dépôt uniquement).
 * Poids par défaut = hypothèses de départ, modifiables dans l'interface. Somme normalisée à l'utilisation.
 */
export const RANKING = {
  defaultWeights: { threatened: 0.35, nearThreatened: 0.1, richness: 0.2, lowEffort: 0.15, fragmentation: 0.1, compensation: 0.1 },
  /** Deux scénarios sont jugés « non départageables » si l'écart de score composite < tieBase + tieUncertainty × part moyenne de surface à faible effort. */
  tieBase: 0.05,
  tieUncertainty: 0.15,
}
