# Dictionnaire des champs (public/data)
**grid.geojson** – une cellule ~1 km par feature. `id` (`ix_iy`), `obs` nb d'observations dédoublonnées (= confiance), `sp` richesse spécifique, `thr` espèces IUCN VU/EN/CR (minimum, statut parfois absent), `nt` quasi menacées, `sp_<g>` / `obs_<g>` richesse et observations par groupe `g` ∈ bird, vert, plant, fung, arth, other.
**species.json** – `rows`: [nom, groupe, catégorie IUCN 0-5 ou null (=non renseignée), protégé 0/1]. L'index de ligne est l'identifiant d'espèce.
**cell_species.json** – id de cellule → indices d'espèces présentes.
**meta.json** – paramètres de grille, plage d'années, groupes, échelle IUCN, sources/licences, statistiques de nettoyage.
