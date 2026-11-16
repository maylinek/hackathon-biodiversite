/** Recherche de lieux : Nominatim (OpenStreetMap), sans clé. Conditions d'usage : https://operations.osmfoundation.org/policies/nominatim/
 *  (≤ 1 requête/s, pas d'autocomplétion : requête uniquement sur action explicite de l'utilisateur, attribution affichée). */
export interface Place { name: string; kind: string; lon: number; lat: number; bbox: [number, number, number, number] | null }
let last = 0
export async function searchPlaces(q: string): Promise<Place[]> {
  const wait = last + 1100 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
  const u = new URL('https://nominatim.openstreetmap.org/search')
  u.search = new URLSearchParams({ format: 'jsonv2', q, countrycodes: 'lu', limit: '8', 'accept-language': 'fr' }).toString()
  const r = await fetch(u)
  if (!r.ok) throw new Error(`Nominatim : HTTP ${r.status}`)
  const j = (await r.json()) as { display_name: string; category?: string; type?: string; lon: string; lat: string; boundingbox?: string[] }[]
  return j.map((p) => ({
    name: p.display_name, kind: [p.category, p.type].filter(Boolean).join(' / '), lon: +p.lon, lat: +p.lat,
    bbox: p.boundingbox ? [+p.boundingbox[2], +p.boundingbox[0], +p.boundingbox[3], +p.boundingbox[1]] : null,
  }))
}
