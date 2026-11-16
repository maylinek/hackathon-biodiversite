# Dictionnaire des champs (public/data)
**grid.geojson** – une cellule ~1 km par feature. `id` (`ix_iy`), `obs` nb d'observations dédoublonnées (= confiance), `sp` richesse spécifique, `thr` espèces IUCN VU/EN/CR (minimum, statut parfois absent), `nt` quasi menacées, `sp_<g>` / `obs_<g>` richesse et observations par groupe `g` ∈ bird, vert, plant, fung, arth, other.
**species.json** – `rows`: [nom, groupe, catégorie IUCN 0-5 ou null (=non renseignée), protégé 0/1]. L'index de ligne est l'identifiant d'espèce.
**cell_species.json** – id de cellule → indices d'espèces présentes.
**meta.json** – paramètres de grille, plage d'années, groupes, échelle IUCN, sources/licences, statistiques de nettoyage.
**observations.json** – observations individuelles conservées (388 964), format colonnaire trié par espèce : `start[i]..start[i+1]` = observations de l'espèce `i` ; `lat`/`lon` en 1e-4° depuis `origin` ; `date` AAAAMMJJ (0 = inconnue) ; `ds` indice dans `datasets` ; `loc` indice dans `localities` (0 = lieu-dit non renseigné). Coordonnées arrondies à 4 décimales (~10 m).
