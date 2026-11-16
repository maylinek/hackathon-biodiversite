# Rapport d'exploration des données

Date : 2026-11-16. Source : API data.public.lu, jeux téléchargés dans `data/raw/` (jamais exécutés).

## Fichiers
| Jeu | Fichier | Taille zip | Contenu | Licence |
|---|---|---|---|---|
| data-mnhn-lu-observation-data | `dwca-gbif-dataportal-occ-mnhnl-v1.49.zip` (v1.48 plus ancienne ignorée) | 5,5 Mo | DwC-A : `occurrence.txt` (70 Mo, TSV, 41 colonnes), `multimedia.txt`, `meta.xml`, `eml.xml` | CC0 1.0 |
| mnhnl-various-project-records-recorder-lux-database | `dwca-gbif-random-occ-mnhnl-v1.38.zip` (v1.37 ignorée) | 7,5 Mo | idem, `occurrence.txt` 146 Mo | CC0 1.0 |
| gbif-luxembourg-datasets | **aucun fichier téléchargeable** : seulement 2 liens (IPT `gbif.mnhn.lu/ipt/` et page de recherche GBIF) | – | – | "Other (Open)" |

Les « 5 fichiers » annoncés par jeu sont en réalité 2 zips versionnés + des liens (IPT, page GBIF). Le jeu 3 n'est **pas intégré** : pas de fichier, licence à vérifier ; ses données sont publiées par le même MNHNL, un doublon avec les jeux 1-2 est probable (non vérifié).

## Colonnes (identiques dans les deux jeux)
41 colonnes Darwin Core, dont : `scientificName`, `kingdom`, `phylum`, `taxonRank`, `decimalLatitude/Longitude`, `geodeticDatum` (WGS84), `eventDate`, `datasetName`, `basisOfRecord`, `recordedBy`, `dynamicProperties`. **Absents : classe, ordre, famille, genre, incertitude des coordonnées.**

## Chiffres
| | Observations (jeu 1) | Projets (jeu 2) |
|---|---|---|
| Lignes | 139 701 | 289 786 |
| Coordonnées manquantes/invalides | 0 % | 0 % |
| Hors bbox Luxembourg (49,44–50,19 N ; 5,72–6,54 E) | 1,3 % | 5,3 % (France/Belgique : Preye, Lorry-Mardigny, Orval…) |
| Précision coordonnées | 4 décimales (~10 m) pour 90 % ; aucun floutage détecté | 95 % à 4 décimales |
| Nom scientifique manquant | 0 % | 0 % |
| Nom non binomial (genre seul) | – | – ; total 6 256 rejetés sur 2 jeux |
| `kingdom`/`phylum` manquants | 10 | 50 |
| `taxonRank` vide | 32 % | 43 % |
| Dates | 1956–2026, 0 % manquantes | 1800–2026, 0 % manquantes |
| `dynamicProperties` (statuts) renseigné | 65 % | 85 % |
| Doublons exacts (nom, coord., date, observateur) | 1,0 % | 5,3 % ; 17 204 retirés au total (inter-jeux compris) |

Années récentes : 9–14 k obs./an (jeu 1) ; 1 800 dates antérieures à 1950 existent (jeu 2, anciennes données LuxNat).

## Statut de conservation
Présent, mais seulement dans `dynamicProperties`, texte `Taxon status for Luxembourg: [...]` (JSON). Valeurs : catégories **IUCN** (Critically endangered, Endangered, Vulnerable, Near threatened, Least concern, Not threatened, Data deficient, Not evaluated), « Regional Extinct », protection nationale (« Intégralement/Partiellement protégé »), Directive Oiseaux (annexes), PNPN 2007-2011, rareté. **C'est la liste rouge nationale/IUCN telle que portée par le MNHNL, sans mention d'année de la liste ni de référentiel détaillé.**
Après nettoyage : 9 615 espèces, dont seulement **2 332 avec une catégorie IUCN** ; 7 283 sans statut (surtout arthropodes et plantes). Le décompte « espèces menacées » (VU/EN/CR) est donc un **minimum**, pas un total.

## Groupe taxonomique
Pas de classe/ordre. Dérivation possible sans rien inventer : `kingdom` (plantes, champignons), `phylum` (arthropodes, chordés), et pour les oiseaux les marqueurs de statut (Brutvogel, Directive Oiseaux, Aves). **Impossibles à isoler** : mammifères, reptiles, amphibiens, poissons dans le jeu « General recording » (36 827 chordés non étiquetés). Les oiseaux d'un jeu ne portant pas de marqueur seront classés « Autres vertébrés ». Les insectes ne sont pas séparables des arachnides/crustacés → groupe « Arthropodes (insectes…) ».

## Décisions (option la plus simple)
1. Groupes : Oiseaux, Autres vertébrés, Plantes, Champignons, Arthropodes, Autres.
2. Menacée = IUCN VU/EN/CR ; Quasi menacée (NT) comptée à part ; espèces sans statut = « non évalué », jamais déclarées non menacées.
3. Espèce = `Genre épithète` (sous-espèces fusionnées, auteurs retirés) ; genres seuls exclus de la richesse.
4. Hors-Luxembourg : bbox (pas de polygone frontière sans couche externe — à valider avec vous). Résiduel : quelques points voisins dans la bbox.
5. Grille ~1 km (0,009° × 0,01395°, ≈ 1 km à 49,8° N), cellules en degrés WGS84 (pas de reprojection LUREF).
6. Toutes les années conservées (pas de pondération temporelle) ; limite signalée.
7. Biais : effort d'observation très inégal (médiane 51 obs./cellule, 415 cellules < 5 obs.) ; l'absence d'observation ≠ absence d'espèce.
8. Reconstructions 3D : ignorées.
