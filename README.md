# Digital Twin Biodiversité Luxembourg (prototype hackathon)

Outil d'aide à la décision, deux modes sur la même carte : **Observation** (observations individuelles MNHNL, filtres groupe/IUCN/période, clusters, fiche d'espèce avec historique, synthèse d'une zone dessinée) et **Simulation** (scénarios, classement multicritère, rapport HTML/PDF). Recherche de lieux via Nominatim (OpenStreetMap). Dessiner une zone de projet sur la carte du Luxembourg, simuler son effet potentiel sur la biodiversité, comparer plusieurs scénarios. Application 100 % front-end (Vite + React + TypeScript, MapLibre GL, Turf, Recharts, terra-draw).

> **Aide à la décision, ne remplace pas une étude d'impact.** Le score est un indice heuristique, pas une prédiction.

## Installation
Node ≥ 20 requis (Node 26 testé). Sur cette machine, Node est installé localement dans `.tools/` :
```bash
export PATH="$PWD/.tools/node-v26.13.1-darwin-arm64/bin:$PATH"
npm install
npm run build-data   # régénère public/data (Python 3 requis, sans dépendance)
npm run dev          # http://localhost:5173
npm run build        # dist/ statique (base relative)
npm test             # tests du moteur (node --test)
```
Les fichiers `public/data` sont déjà générés. Les données brutes (`data/raw`, non versionnées) se téléchargent depuis data.public.lu (voir `docs/data-report.md`) ; le script lit `data/raw/obs/occurrence.txt` et `data/raw/projects/occurrence.txt`.

## Pipeline de données
`scripts/build-data/build_data.py` : lit les deux archives Darwin Core, rejette coordonnées invalides, points hors emprise (49,44–50,19 N ; 5,72–6,54 E), noms non binomiaux et doublons (espèce, coord. arrondies à 4 décimales, date, observateur), puis agrège sur une grille d'environ 1 km. Sorties : `grid.geojson`, `species.json`, `cell_species.json`, `meta.json`, dictionnaire `FIELDS.md`. Constats détaillés : `docs/data-report.md`.

## Hypothèses du modèle (src/engine/config.ts, seul fichier de coefficients)
- Valeur d'une cellule = 0,6 × richesse + 0,4 × espèces menacées, chacune normalisée (plafonnée au percentile 95 national).
- Direct = coef. projet × coef. phase × part de cellule recouverte × valeur. Indirect = idem avec coef. indirect, décroissance (1 − d/R)² intégrée sur 3 anneaux.
- Compensation : réduit seulement le direct, de (% restauré × efficacité du preset, < 1). Gain écologique non modélisé.
- Score = 100 × (1 − exp(−indice/8)). Niveaux : < 20 faible, < 45 modéré, < 70 élevé, au-delà très élevé.
- Coefficients par type de projet et par groupe : jugement d'expert, non calibrés.
- Confiance : médiane pondérée des observations par cellule touchée (haute ≥ 30, faible < 10 ou > 40 % de l'influence sur des cellules < 5 obs.).
Visible dans l'application : panneau « Méthode et limites ».

## Classement des scénarios et écopoints
Indicateurs calculés sur les données du dépôt (src/engine/ranking.ts, poids par défaut dans `RANKING` de config.ts, modifiables dans l'interface) : espèces menacées, quasi menacées, richesse, part de surface à faible effort d'observation, fragmentation (proxy : km de linéaire en zone observée), compensation (aire dessinée ÷ emprise). Scénarios « non départageables » signalés selon l'incertitude.
**Barème écopoints non appliqué** : il porte sur des types de biotopes, absents des données (voir l'onglet Méthode et le rapport).
`public/data/observations.json` (ajout au pipeline, ~10 Mo) alimente la carte d'observations ; les autres fichiers de données sont inchangés.

## Limites connues
- Effort d'observation inégal ; absence de donnée ≠ absence d'espèce. Toutes années confondues (1800–2026).
- Statut IUCN renseigné pour 2 332 espèces sur 9 615 : « menacées » = minimum.
- Pas de classe/ordre : mammifères, reptiles, amphibiens, poissons regroupés (« Autres vertébrés ») ; insectes non séparés des arthropodes.
- Filtre géographique par rectangle (pas de frontière) : quelques points frontaliers subsistent ; grille en degrés.
- Jeu GBIF Luxembourg non intégré (aucun fichier, licence « Other (Open) » à vérifier).
- Pas de sélecteur FR/EN (interface en français uniquement). Fond de carte OpenFreeMap (réseau requis).
- Les dessins ne sont pas éditables après coup (redessiner). Le rapport s'ouvre en HTML imprimable (impression → PDF).
