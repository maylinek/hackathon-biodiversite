#!/usr/bin/env python3
"""Pipeline: DwC-A occurrence.txt (data/raw/*) -> grille agrégée (public/data).
Usage: python3 -I scripts/build-data/build_data.py   (npm run build-data)
Lit uniquement les fichiers texte (jamais exécutés). Aucune donnée inventée."""
import csv, json, re, math, collections, sys, os
csv.field_size_limit(10**8)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SOURCES = [("obs", "data.mnhn.lu observation data"), ("projects", "MNHNL various project records")]
OUT = os.path.join(ROOT, "public", "data")
# Emprise approximative du Grand-Duché (bbox : inclut de petites parties de pays voisins, cf. docs)
LAT0, LAT1, LON0, LON1 = 49.44, 50.19, 5.72, 6.54
CELL_KM = 1.0
DLAT = CELL_KM / 111.2
DLON = CELL_KM / (111.2 * math.cos(math.radians(49.8)))
BIRD_MARK = ("Brutvogel", "Bird directive", "(Aves)")
RANK = {"Critically endangered": 5, "Endangered": 4, "Vulnerable": 3, "Near threatened": 2,
        "Least concern": 1, "Not threatened": 1, "Data deficient": 0, "Not evaluated": 0}
THREATENED = {3, 4, 5}
GROUPS = {"bird": "Oiseaux", "vert": "Autres vertébrés", "plant": "Plantes", "fung": "Champignons",
          "arth": "Arthropodes (insectes…)", "other": "Autres"}
NAME_RE = re.compile(r"^([A-Z][a-zà-ÿ-]+)\s+(?:×\s*)?([a-z][a-zà-ÿ-]+)")

def group_of(row, is_bird):
    k, p = row["kingdom"], row["phylum"]
    if k == "Plantae": return "plant"
    if k == "Fungi": return "fung"
    if p == "Chordata": return "bird" if is_bird else "vert"
    if p == "Arthropoda": return "arth"
    return "other"

def parse_status(dp):
    toks = []
    if dp.startswith("Taxon status for Luxembourg:"):
        try: toks = json.loads(dp.split(":", 1)[1].strip())
        except Exception: pass
    toks = [re.sub(r"\s+", " ", t) for t in toks]
    iucn = max((RANK[t.split(" - IUCN")[0].strip()] for t in toks if " - IUCN" in t and t.split(" - IUCN")[0].strip() in RANK), default=None)
    bird = any(m in t for t in toks for m in BIRD_MARK)
    prot = any(t in ("Intégralement protégé", "Partiellement protégé") for t in toks)
    return iucn, bird, prot, any(t == "Regional Extinct" for t in toks)

def main():
    stats = collections.Counter(); seen = set()
    sp = {}                     # key -> dict(name, group votes, iucn, prot, bird)
    cells = {}                  # (ix,iy) -> dict
    years = [9999, 0]
    for folder, _ in SOURCES:
        path = os.path.join(ROOT, "data", "raw", folder, "occurrence.txt")
        with open(path, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
                stats["lues"] += 1
                try: la = float(row["decimalLatitude"]); lo = float(row["decimalLongitude"])
                except ValueError: stats["rejet_coord_invalide"] += 1; continue
                if not (LAT0 <= la <= LAT1 and LON0 <= lo <= LON1): stats["rejet_hors_luxembourg"] += 1; continue
                m = NAME_RE.match(row["scientificName"] or "")
                if not m: stats["rejet_nom_non_binomial"] += 1; continue
                key = f"{m.group(1)} {m.group(2)}"
                dk = (key, round(la, 4), round(lo, 4), row["eventDate"], row["recordedBy"])
                if dk in seen: stats["rejet_doublon"] += 1; continue
                seen.add(dk)
                iucn, bird, prot, _re = parse_status(row["dynamicProperties"])
                s = sp.setdefault(key, {"n": key, "g": collections.Counter(), "i": None, "p": False})
                if iucn is not None: s["i"] = iucn if s["i"] is None else max(s["i"], iucn)
                s["p"] = s["p"] or prot
                g = group_of(row, bird)
                s["g"][g] += 1
                ym = re.match(r"(\d{4})", row["eventDate"] or "")
                if ym: y = int(ym.group(1)); years[0] = min(years[0], y); years[1] = max(years[1], y)
                ix = int((lo - LON0) / DLON); iy = int((la - LAT0) / DLAT)
                c = cells.setdefault((ix, iy), {"obs": 0, "sp": collections.Counter(), "gobs": collections.Counter()})
                c["obs"] += 1; c["sp"][key] += 1; stats["conservees"] += 1
    # espèce -> groupe majoritaire
    keys = sorted(sp); idx = {k: i for i, k in enumerate(keys)}
    sp_group = {k: sp[k]["g"].most_common(1)[0][0] for k in keys}
    feats = []; cell_species = {}
    for (ix, iy), c in sorted(cells.items()):
        w, s = LON0 + ix * DLON, LAT0 + iy * DLAT
        props = {"id": f"{ix}_{iy}", "obs": c["obs"], "sp": len(c["sp"]), "thr": 0, "nt": 0}
        for g in GROUPS: props[f"sp_{g}"] = 0; props[f"obs_{g}"] = 0
        for k, n in c["sp"].items():
            g = sp_group[k]; props[f"sp_{g}"] += 1; props[f"obs_{g}"] += n
            i = sp[k]["i"]
            if i in THREATENED: props["thr"] += 1
            elif i == 2: props["nt"] += 1
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [[
            [round(w, 5), round(s, 5)], [round(w + DLON, 5), round(s, 5)], [round(w + DLON, 5), round(s + DLAT, 5)],
            [round(w, 5), round(s + DLAT, 5)], [round(w, 5), round(s, 5)]]]}})
        cell_species[props["id"]] = sorted(idx[k] for k in c["sp"])
    os.makedirs(OUT, exist_ok=True)
    def dump(name, obj):
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    dump("grid.geojson", {"type": "FeatureCollection", "features": feats})
    dump("species.json", {"fields": ["name", "group", "iucn", "protected"], "rows": [
        [k, sp_group[k], sp[k]["i"], 1 if sp[k]["p"] else 0] for k in keys]})
    dump("cell_species.json", cell_species)
    meta = {"cell_km": CELL_KM, "dlat": DLAT, "dlon": DLON, "origin": [LON0, LAT0], "bbox": [LON0, LAT0, LON1, LAT1],
            "years": years, "groups": GROUPS, "iucn_scale": {"0": "Données insuffisantes / non évalué", "1": "Préoccupation mineure / non menacé",
            "2": "Quasi menacé", "3": "Vulnérable", "4": "En danger", "5": "En danger critique"},
            "sources": [{"name": "MNHNL – data.mnhn.lu observation data", "license": "CC0 1.0", "url": "https://data.public.lu/fr/datasets/data-mnhn-lu-observation-data/"},
                        {"name": "MNHNL – various project records (Recorder-Lux)", "license": "CC0 1.0", "url": "https://data.public.lu/fr/datasets/mnhnl-various-project-records-recorder-lux-database/"},
                        {"name": "GBIF Luxembourg", "license": "Other (Open) – non intégré (voir docs/data-report.md)", "url": "https://data.public.lu/fr/datasets/gbif-luxembourg-datasets/"}],
            "stats": dict(stats), "n_cells": len(feats), "n_species": len(keys)}
    dump("meta.json", meta)
    print(json.dumps(meta["stats"], indent=1, ensure_ascii=False)); print("cellules", len(feats), "espèces", len(keys), "années", years)

if __name__ == "__main__": main()
