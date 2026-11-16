import { useEffect, useMemo, useRef, useState } from 'react'
import * as turf from '@turf/turf'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { PRESETS } from './engine/config.ts'
import { baselineResult, buildFootprint, computeReferences, simulate } from './engine/engine.ts'
import type { Footprint, Phase, PresetId, SimulationResult } from './engine/types.ts'
import { loadAll } from './data.ts'
import type { Loaded } from './data.ts'
import { BASELINE_ID, baseline, colorOf, defaultParams, loadSaved, newId, save } from './scenarios.ts'
import type { Scenario } from './scenarios.ts'
import MapView, { BIO_RAMP, GROUP_COLORS, IMPACT_RAMP } from './components/MapView.tsx'
import type { DrawMode, FlyTarget } from './components/MapView.tsx'
import SpeciesSheet from './components/SpeciesSheet.tsx'
import Ranking from './components/Ranking.tsx'
import { RANKING } from './engine/config.ts'
import { rankScenarios } from './engine/ranking.ts'
import type { Weights } from './engine/ranking.ts'
import { filteredIndices, loadObservations, summarizeZone, toPoints } from './observations.ts'
import type { ObsFilter, ObsStore } from './observations.ts'
import { searchPlaces } from './places.ts'
import type { Place } from './places.ts'
import Compare from './components/Compare.tsx'
import ResultSheet from './components/ResultSheet.tsx'
import Method from './components/Method.tsx'
import { Field, Tip } from './components/ui.tsx'
import { GROUP_FR, fmt, iucnLabel } from './labels.ts'
import { GROUP_IDS } from './engine/types.ts'
import type { GroupId } from './engine/types.ts'
import { buildReportHtml, download, openReport, ECOPOINTS_NOTE } from './report.ts'

const METRICS = [
  { id: 'sp', label: 'Richesse spécifique', prop: 'sp', tip: 'Nombre d\'espèces distinctes observées dans la cellule (~1 km²).' },
  { id: 'thr', label: 'Espèces menacées (min.)', prop: 'thr', tip: 'Espèces IUCN Vulnérable, En danger ou En danger critique. Minimum : beaucoup d\'espèces n\'ont pas de statut.' },
  { id: 'obs', label: 'Effort d\'observation', prop: 'obs', tip: 'Nombre d\'observations dédoublonnées. Sert d\'indice de confiance.' },
  ...GROUP_IDS.map((g) => ({ id: g, label: `Groupe : ${GROUP_FR[g]}`, prop: `sp_${g}`, tip: 'Richesse spécifique du groupe taxonomique.' })),
]
const quantiles = (vals: number[], n = 5) => {
  const v = vals.filter((x) => x > 0).sort((a, b) => a - b)
  const out = [...new Set(Array.from({ length: n - 1 }, (_, i) => v[Math.floor(((i + 1) / n) * v.length)]).filter((x) => x !== undefined))]
  return out
}
const emptyFC: FeatureCollection = { type: 'FeatureCollection', features: [] }

type AppMode = 'observation' | 'simulation'
type Target = 'obs' | 'scenario' | 'comp'
const IUCN_OPTS = [['', 'Tous statuts'], ['threat', 'Menacées (VU/EN/CR)'], ['nt', 'Quasi menacées'], ['lc', 'Préoccupation mineure'], ['dd', 'Données insuffisantes'], ['none', 'Non évalué (statut absent)']]

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapMsg, setMapMsg] = useState<string | null>(null)
  const saved = useMemo(() => loadSaved(), [])
  const [scenarios, setScenarios] = useState<Scenario[]>(saved?.scenarios ?? [baseline(), { id: newId(), name: 'Scénario 1', shape: null, params: defaultParams('building') }])
  const [activeId, setActiveId] = useState(saved?.activeId ?? scenarios[1].id)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [view, setView] = useState<'map' | 'compare' | 'report'>('map')
  const [appMode, setAppMode] = useState<AppMode>('observation')
  const [metric, setMetric] = useState('sp')
  const [mode, setMode] = useState<'bio' | 'impact'>('bio')
  const [drawMode, setDrawMode] = useState<DrawMode>(null)
  const [target, setTarget] = useState<Target>('obs')
  const [editing, setEditing] = useState(false)
  const [method, setMethod] = useState(false)
  const [refId, setRefId] = useState('')
  const [saveOk, setSaveOk] = useState(true)
  const [weights, setWeights] = useState<Weights>({ ...RANKING.defaultWeights })
  // observations
  const [obsStore, setObsStore] = useState<ObsStore | null>(null)
  const [obsError, setObsError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ObsFilter | null>(null)
  const [showObs, setShowObs] = useState(true)
  const [showGrid, setShowGrid] = useState(false)
  const [obsZone, setObsZone] = useState<Footprint | null>(null)
  const [pick, setPick] = useState<{ id: number; obs: number | null } | null>(null)
  const [spQuery, setSpQuery] = useState('')
  // recherche de lieux
  const [placeQ, setPlaceQ] = useState('')
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [placeBusy, setPlaceBusy] = useState(false)
  const [placeErr, setPlaceErr] = useState<string | null>(null)
  const [fly, setFly] = useState<FlyTarget | null>(null)

  useEffect(() => {
    loadAll().then((l) => {
      setLoaded(l); setFilter({ groups: new Set(GROUP_IDS), iucn: '', yearMin: l.meta.years[0], yearMax: l.meta.years[1] })
      loadObservations(import.meta.env.BASE_URL, l.data.species.length).then(setObsStore).catch((e) => setObsError(String(e.message ?? e)))
    }).catch((e) => setError(String(e.message ?? e)))
  }, [])
  useEffect(() => { setSaveOk(save(scenarios, activeId)) }, [scenarios, activeId])

  const refs = useMemo(() => (loaded ? computeReferences(loaded.data.cells) : null), [loaded])
  // compensation effective : zone dessinée (surface compensée / emprise) sinon curseur
  const scEff = useMemo<Scenario[]>(() => scenarios.map((s) => {
    if (!s.comp || !s.shape) return s
    try {
      const fp = turf.area(buildFootprint(s.shape, s.params)) / 1e4, c = turf.area(s.comp) / 1e4
      return { ...s, params: { ...s.params, compensationPct: fp > 0 ? Math.min(100, Math.round((c / fp) * 100)) : 0 } }
    } catch { return s }
  }), [scenarios])
  const cache = useRef(new Map<string, SimulationResult>())
  const [calcError, setCalcError] = useState<string | null>(null)
  const results = useMemo(() => {
    const out: Record<string, SimulationResult | null> = {}
    if (!loaded || !refs) return out
    for (const s of scEff) {
      if (s.id === BASELINE_ID) { out[s.id] = baselineResult(); continue }
      if (!s.shape) { out[s.id] = null; continue }
      const key = JSON.stringify([s.shape, s.params])
      let r = cache.current.get(key)
      if (!r) {
        try { r = simulate(s.shape, s.params, loaded.data, refs); cache.current.set(key, r) } catch (e) { setTimeout(() => setCalcError(`Calcul impossible pour « ${s.name} » : ${(e as Error).message}`)); r = undefined }
      }
      out[s.id] = r ?? null
    }
    return out
  }, [scEff, loaded, refs])
  const ranking = useMemo(() => rankScenarios(scEff.filter((s) => s.id !== BASELINE_ID && results[s.id]).map((s) => ({ id: s.id, result: results[s.id]!, compensationPct: s.params.compensationPct })), weights), [scEff, results, weights])

  const active = scenarios.find((s) => s.id === activeId) ?? scenarios[0]
  const activeEff = scEff.find((s) => s.id === active.id) ?? active
  const isBase = active.id === BASELINE_ID
  const upd = (patch: Partial<Scenario>) => setScenarios((l) => l.map((s) => (s.id === active.id ? { ...s, ...patch } : s)))
  const updParams = (patch: Partial<Scenario['params']>) => upd({ params: { ...active.params, ...patch } })
  const cfg = PRESETS[active.params.preset]
  const sim = appMode === 'simulation'

  const breaks = useMemo(() => (loaded ? quantiles(loaded.grid.features.map((f) => Number(f.properties?.[METRICS.find((m) => m.id === metric)!.prop] ?? 0))) : []), [loaded, metric])
  const activeRes = results[active.id]
  const impactFC = useMemo<FeatureCollection>(() => {
    if (!loaded || !activeRes) return emptyFC
    const byId = new Map(loaded.grid.features.map((f) => [String(f.properties?.id), f]))
    return { type: 'FeatureCollection', features: activeRes.cells.filter((c) => c.impact > 0).map((c) => ({ ...(byId.get(c.id) as Feature<Polygon>), properties: { impact: c.impact } })) }
  }, [loaded, activeRes])
  const impactBreaks = useMemo(() => { const m = Math.max(1e-9, ...impactFC.features.map((f) => f.properties!.impact as number)); return [0.1, 0.25, 0.5, 0.75].map((x) => x * m) }, [impactFC])
  const shapes = useMemo<FeatureCollection>(() => {
    if (!sim) return { type: 'FeatureCollection', features: obsZone && !(editing && target === 'obs') ? [{ ...obsZone, properties: { color: '#1f5a46', active: true, kind: 'zone' } }] : [] }
    const f: Feature[] = []
    for (const s of scenarios) {
      const color = colorOf(scenarios, s.id)
      const hide = editing && s.id === active.id
      if (s.shape && !(hide && target === 'scenario')) f.push({ ...(s.shape as Footprint), properties: { color, active: s.id === active.id, kind: 'shape' } })
      if (s.comp && !(hide && target === 'comp')) f.push({ ...(s.comp as Footprint), properties: { color, active: s.id === active.id, kind: 'comp' } })
    }
    return { type: 'FeatureCollection', features: f }
  }, [sim, scenarios, active.id, obsZone, editing, target])
  const zone = useMemo<FeatureCollection>(() => {
    if (!sim || !active.shape || active.params.radiusM <= 0) return emptyFC
    try { return { type: 'FeatureCollection', features: [turf.buffer(buildFootprint(active.shape, active.params), active.params.radiusM / 1000, { units: 'kilometers' })!] } } catch { return emptyFC }
  }, [sim, active.shape, active.params])

  // observations filtrées, points, synthèse de zone
  const idx = useMemo(() => (obsStore && loaded && filter ? filteredIndices(filter, obsStore, loaded.data.species) : null), [obsStore, loaded, filter])
  const obsPoints = useMemo(() => (idx && obsStore && loaded && showObs ? toPoints(idx, obsStore, loaded.data.species) : null), [idx, obsStore, loaded, showObs])
  const zoneSummary = useMemo(() => {
    if (!idx || !obsStore || !loaded || !obsZone || obsZone.geometry.type !== 'Polygon') return null
    return summarizeZone(obsZone as Feature<Polygon>, idx, obsStore, loaded.data.species)
  }, [idx, obsStore, loaded, obsZone])
  const spMatches = useMemo(() => {
    const q = spQuery.trim().toLowerCase(); if (!loaded || q.length < 3) return []
    const out: number[] = []
    for (let i = 0; i < loaded.data.species.length && out.length < 8; i++) if (loaded.data.species[i].name.toLowerCase().includes(q)) out.push(i)
    return out
  }, [loaded, spQuery])

  const switchMode = (m: AppMode) => {
    setAppMode(m); setDrawMode(null); setEditing(false); setView('map'); setPick(null)
    setTarget(m === 'simulation' ? 'scenario' : 'obs')
    setShowObs(m === 'observation'); setShowGrid(m === 'simulation'); setMode('bio')
    if (m === 'simulation') setStep(1)
  }
  const currentShape = (t: Target): Footprint | null => (t === 'obs' ? obsZone : t === 'comp' ? active.comp ?? null : active.shape)
  const startDraw = (t: Target, m: DrawMode) => {
    setEditing(false); setTarget(t); setView('map'); setDrawMode(drawMode === m && target === t ? null : m)
  }
  const onDrawn = (f: Footprint) => {
    setDrawMode(null)
    if (target === 'obs') { if (f.geometry.type === 'Polygon') setObsZone(f) }
    else if (target === 'comp') { if (f.geometry.type === 'Polygon') upd({ comp: f }) }
    else { if (isBase) return; upd({ shape: f }); setMode('impact'); setStep(2) }
  }
  const onEdited = (f: Footprint) => { if (target === 'obs') setObsZone(f); else if (target === 'comp') upd({ comp: f as Footprint }); else upd({ shape: f }) }
  const clearShape = (t: Target) => { setEditing(false); if (t === 'obs') setObsZone(null); else if (t === 'comp') upd({ comp: null }); else upd({ shape: null }) }
  const addScenario = (dup: boolean) => {
    const n = scenarios.length
    const s: Scenario = dup && !isBase ? { ...structuredClone(active), id: newId(), name: `${active.name} (copie)` } : { id: newId(), name: `Scénario ${n}`, shape: null, params: defaultParams('building') }
    setScenarios((l) => [...l, s]); setActiveId(s.id)
  }
  const remove = (id: string) => {
    if (id === BASELINE_ID || !window.confirm('Supprimer ce scénario ?')) return
    setScenarios((l) => l.filter((s) => s.id !== id)); if (activeId === id) setActiveId(BASELINE_ID)
  }
  const goStep = (n: 1 | 2 | 3) => { setStep(n); setView(n === 3 ? 'compare' : 'map'); if (n !== 1) { setDrawMode(null); setEditing(false) } }
  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault(); const q = placeQ.trim(); if (q.length < 2) return
    setPlaceBusy(true); setPlaceErr(null)
    try { const r = await searchPlaces(q); setPlaces(r); if (!r.length) setPlaceErr('Aucun résultat.') } catch (er) { setPlaces(null); setPlaceErr(`Recherche indisponible (${(er as Error).message}).`) }
    setPlaceBusy(false)
  }
  const goPlace = (p: Place) => setFly({ token: Date.now(), ...(p.bbox && (p.bbox[2] - p.bbox[0] > 0.0005 || p.bbox[3] - p.bbox[1] > 0.0005) ? { bbox: p.bbox } : { center: [p.lon, p.lat] as [number, number], zoom: 16 }) })

  if (error) return <div className="state error" role="alert"><h1>Erreur de chargement des données</h1><p>{error}</p><p>Lancez <code>npm run build-data</code> puis rechargez la page.</p></div>
  if (!loaded || !filter) return <div className="state" role="status"><p>Chargement des données de biodiversité…</p></div>
  const { meta, data } = loaded
  const metricDef = METRICS.find((m) => m.id === metric)!
  const projectsReady = scenarios.filter((s) => s.id !== BASELINE_ID && results[s.id]).length
  const reportHtml = () => buildReportHtml({ scenarios: scEff, results, ranking, weights, data, meta })
  const editingShape = editing ? currentShape(target) : null

  const DrawTools = ({ t, lineOk, label }: { t: Target; lineOk?: boolean; label: string }) => {
    const shape = currentShape(t)
    const on = (m: DrawMode) => drawMode === m && target === t
    return <div className="drawtools">
      <div className="btns" role="group" aria-label={`Dessiner : ${label}`}>
        <button className={on('polygon') ? 'on' : ''} onClick={() => startDraw(t, 'polygon')}>▱ Polygone</button>
        <button className={on('rectangle') ? 'on' : ''} onClick={() => startDraw(t, 'rectangle')}>▭ Rectangle</button>
        <button className={on('circle') ? 'on' : ''} onClick={() => startDraw(t, 'circle')}>◯ Cercle</button>
        {lineOk && <button className={on('line') ? 'on' : ''} onClick={() => startDraw(t, 'line')}>⟋ Ligne</button>}
      </div>
      {drawMode && target === t && <p className="hint" role="status">{drawMode === 'line' ? 'Cliquez pour poser les points, double-clic pour terminer.' : drawMode === 'rectangle' ? 'Cliquez deux coins opposés.' : drawMode === 'circle' ? 'Cliquez le centre, puis un second clic fixe le rayon.' : 'Cliquez pour poser les sommets, double-clic (ou re-clic sur le dernier) pour fermer.'}</p>}
      {shape && <div className="btns">
        <button className={editing && target === t ? 'on' : ''} onClick={() => { setDrawMode(null); setTarget(t); setEditing(!(editing && target === t)) }}>{editing && target === t ? '✔ Terminer l\'édition' : '✎ Modifier la forme'}</button>
        <button onClick={() => clearShape(t)}>🗑 Supprimer</button>
      </div>}
      {editing && target === t && <p className="hint">Glissez la forme ou ses sommets ; points intermédiaires pour en ajouter ; sommet sélectionné + Suppr pour l'enlever.</p>}
    </div>
  }

  return (
    <div className="app">
      <header>
        <h1>🌿 Digital Twin Biodiversité Luxembourg</h1>
        <p className="banner" role="note">Aide à la décision, ne remplace pas une étude d'impact.</p>
        <button onClick={() => setMethod(true)}>Méthode et limites</button>
      </header>
      {(mapMsg || calcError || obsError || !saveOk) && <div className="notice" role="alert">{mapMsg}{calcError}{obsError && `Observations indisponibles : ${obsError}. Lancez npm run build-data.`}{!saveOk && ' Sauvegarde locale indisponible (navigateur) : exportez vos scénarios en JSON.'}</div>}
      <div className="main">
        <aside className="side" aria-label="Panneau de contrôle">
          <form className="search" role="search" onSubmit={doSearch}>
            <label className="flabel" htmlFor="place-q">Rechercher un lieu (ville, quartier, point d'intérêt)</label>
            <div className="searchrow"><input id="place-q" value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} placeholder="ex. Findel, Kirchberg…" /><button className="primary" type="submit" disabled={placeBusy}>{placeBusy ? '…' : 'Chercher'}</button></div>
            {placeErr && <p className="hint" role="status">{placeErr}</p>}
            {places && places.length > 0 && <ul className="places">{places.map((p, i) => <li key={i}><button type="button" onClick={() => goPlace(p)}>{p.name}<small>{p.kind}</small></button></li>)}</ul>}
            <p className="hint">Résultats © contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> via Nominatim (Luxembourg uniquement, requête sur validation).</p>
          </form>

          <div className="modes" role="tablist" aria-label="Mode">
            <button role="tab" aria-selected={!sim} className={!sim ? 'on' : ''} onClick={() => switchMode('observation')}>Observation</button>
            <button role="tab" aria-selected={sim} className={sim ? 'on' : ''} onClick={() => switchMode('simulation')}>Simulation</button>
          </div>

          {pick && obsStore && <SpeciesSheet id={pick.id} sp={data.species[pick.id]} obs={obsStore} highlight={pick.obs} onClose={() => setPick(null)} />}

          {!sim && <section aria-labelledby="o1">
            <h2 id="o1">Observation : zone d'étude</h2>
            <p className="hint">Dessinez une zone pour lister les espèces observées (présentes ou passées) et leurs caractéristiques. Cliquez un point de la carte pour ouvrir la fiche de l'espèce.</p>
            <DrawTools t="obs" label="zone d'étude" />
            {obsZone && zoneSummary && <div className="card">
              <h3>Dans la zone ({fmt(turf.area(obsZone) / 1e6, 2)} km²)</h3>
              {zoneSummary.total === 0 ? <p>Aucune observation dans la zone avec ces filtres. <b>Cela ne prouve pas l'absence d'espèces</b> (effort d'observation inégal).</p> : <>
                <p><b>{zoneSummary.total.toLocaleString('fr-FR')}</b> observations · <b>{zoneSummary.speciesIds.length}</b> espèces · période {zoneSummary.first ? `${zoneSummary.first}–${zoneSummary.last}` : 'non renseignée'}</p>
                <p>Menacées (VU/EN/CR) : <b>{zoneSummary.threatened.length}</b> · quasi menacées : <b>{zoneSummary.nearThreatened.length}</b> · statut non évalué : <b>{zoneSummary.unassessed}</b></p>
                <table><thead><tr><th>Groupe</th><th>Espèces</th><th>Obs.</th></tr></thead><tbody>{GROUP_IDS.filter((g) => zoneSummary.byGroup[g].obs > 0).map((g) => <tr key={g}><td><span className="dot" style={{ background: GROUP_COLORS[g] }} />{GROUP_FR[g]}</td><td>{zoneSummary.byGroup[g].sp}</td><td>{zoneSummary.byGroup[g].obs}</td></tr>)}</tbody></table>
                <p className="hint">Jeux : {zoneSummary.datasets.slice(0, 4).map((d) => `${d.name} (${d.n})`).join(' ; ')}{zoneSummary.datasets.length > 4 ? '…' : ''}</p>
                <details><summary>Espèces menacées et quasi menacées ({zoneSummary.threatened.length + zoneSummary.nearThreatened.length})</summary>
                  <ul className="spl">{[...zoneSummary.threatened, ...zoneSummary.nearThreatened].map((id) => <li key={id}><button className="link" onClick={() => setPick({ id, obs: null })}><i>{data.species[id].name}</i></button> – {iucnLabel(data.species[id].iucn)}</li>)}</ul></details>
                <details><summary>Toutes les espèces ({zoneSummary.speciesIds.length})</summary>
                  <ul className="spl">{zoneSummary.speciesIds.slice(0, 200).map((id) => <li key={id}><button className="link" onClick={() => setPick({ id, obs: null })}><i>{data.species[id].name}</i></button> – {GROUP_FR[data.species[id].group]}</li>)}</ul>{zoneSummary.speciesIds.length > 200 && <p className="hint">200 premières sur {zoneSummary.speciesIds.length}.</p>}</details>
              </>}
            </div>}

            <h3>Filtres des observations</h3>
            {!obsStore && !obsError && <p className="hint" role="status">Chargement des observations (≈ 10 Mo)…</p>}
            <fieldset className="groups"><legend className="flabel">Groupes</legend>
              {GROUP_IDS.map((g) => <label key={g} className="chk"><input type="checkbox" checked={filter.groups.has(g)} onChange={(e) => { const n = new Set(filter.groups); if (e.target.checked) n.add(g); else n.delete(g); setFilter({ ...filter, groups: n }) }} /><span className="dot" style={{ background: GROUP_COLORS[g] }} />{GROUP_FR[g]}</label>)}
            </fieldset>
            <Field label="Statut IUCN" tip="Statut tel que fourni par les données. « Non évalué » = statut absent, pas « non menacé ».">
              <select value={filter.iucn} onChange={(e) => setFilter({ ...filter, iucn: e.target.value })}>{IUCN_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Field>
            <div className="yrs"><Field label="De (année)"><input type="number" min={meta.years[0]} max={filter.yearMax} value={filter.yearMin} onChange={(e) => setFilter({ ...filter, yearMin: Math.max(meta.years[0], +e.target.value || meta.years[0]) })} /></Field>
              <Field label="à (année)"><input type="number" min={filter.yearMin} max={meta.years[1]} value={filter.yearMax} onChange={(e) => setFilter({ ...filter, yearMax: Math.min(meta.years[1], +e.target.value || meta.years[1]) })} /></Field></div>
            <p className="hint" aria-live="polite">{idx ? `${idx.length.toLocaleString('fr-FR')} observations correspondent aux filtres.` : ''} Les observations sans date ne s'affichent que sur la période complète.</p>
            <label className="chk"><input type="checkbox" checked={showObs} onChange={(e) => setShowObs(e.target.checked)} />Afficher les observations (clusters aux petits zooms)</label>
            <label className="chk"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />Afficher la grille de richesse (1 km)</label>
            {showGrid && <Field label="Couche de la grille" tip={metricDef.tip}><select value={metric} onChange={(e) => setMetric(e.target.value)}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>}
            <Field label="Chercher une espèce (nom scientifique)"><input value={spQuery} onChange={(e) => setSpQuery(e.target.value)} placeholder="ex. Neomys fodiens" /></Field>
            {spMatches.length > 0 && <ul className="spl">{spMatches.map((id) => <li key={id}><button className="link" onClick={() => setPick({ id, obs: null })}><i>{data.species[id].name}</i></button> – {GROUP_FR[data.species[id].group]}</li>)}</ul>}
          </section>}

          {sim && <>
          <nav className="steps" aria-label="Étapes">
            {([[1, 'Zone'], [2, 'Projet'], [3, 'Comparer']] as const).map(([n, l]) => <button key={n} className={step === n ? 'on' : ''} aria-current={step === n ? 'step' : undefined} onClick={() => goStep(n)}><span>{n}</span>{l}</button>)}
          </nav>
          <div className="scn-select">
            <Field label="Scénario actif"><select value={activeId} onChange={(e) => { setActiveId(e.target.value); setEditing(false) }}>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>

          {step === 1 && <section aria-labelledby="s1">
            <h2 id="s1">1. Dessiner le projet</h2>
            {isBase ? <p className="empty">Le scénario de référence n'a pas de zone. Choisissez ou créez un autre scénario.</p> : <>
              <p>Emprise du projet pour « {active.name} » (ex. extension d'aéroport : un scénario par direction, nord / sud / est).</p>
              <DrawTools t="scenario" lineOk label="emprise du projet" />
              {active.shape && <p>✔ Emprise : {activeRes ? `${fmt(activeRes.footprintHa)} ha` : '…'}</p>}
              {active.shape && <><h3>Compensation (optionnel)</h3><p className="hint">Dessinez la zone restaurée/compensée : son aire rapportée à l'emprise donne le % compensé.</p>
                <DrawTools t="comp" label="zone de compensation" />
                {active.comp && <p>✔ Compensation dessinée : {activeEff.params.compensationPct} % de l'emprise.</p>}</>}
              {active.shape && <button className="primary" onClick={() => goStep(2)}>Continuer : définir le projet →</button>}
            </>}
            <h3>Couches de la carte</h3>
            <div className="btns"><button className={mode === 'bio' ? 'on' : ''} onClick={() => setMode('bio')}>Biodiversité</button><button className={mode === 'impact' ? 'on' : ''} disabled={!activeRes || isBase} onClick={() => setMode('impact')}>Impact du scénario</button></div>
            <Field label="Couche affichée" tip={metricDef.tip}>
              <select value={metric} onChange={(e) => { setMetric(e.target.value); setMode('bio') }}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            </Field>
            <label className="chk"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />Grille de richesse</label>
            <label className="chk"><input type="checkbox" checked={showObs} onChange={(e) => setShowObs(e.target.checked)} />Observations (points)</label>
          </section>}

          {step === 2 && <section aria-labelledby="s2">
            <h2 id="s2">2. Projet</h2>
            {isBase ? <p className="empty">Le scénario « sans projet » sert de référence et n'est pas modifiable.</p> : <>
              <Field label="Nom du scénario"><input value={active.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
              <Field label="Type de projet" tip={cfg.help}>
                <select value={active.params.preset} onChange={(e) => { const p = e.target.value as PresetId; upd({ params: { ...defaultParams(p), phase: active.params.phase, compensationPct: active.params.compensationPct } }) }}>
                  {Object.entries(PRESETS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
                </select>
              </Field>
              {cfg.linear && active.shape?.geometry.type === 'Polygon' && <p className="hint">Ce type est linéaire : redessinez une ligne à l'étape 1 (le polygone sera utilisé tel quel).</p>}
              {!cfg.linear && active.shape?.geometry.type === 'LineString' && <p className="hint">Ce type est surfacique : le tracé linéaire sera tamponné de {active.params.widthM} m.</p>}
              {active.shape?.geometry.type === 'LineString'
                ? <Field label={`Largeur d'emprise : ${active.params.widthM} m`} tip="Largeur de la bande occupée par l'infrastructure linéaire."><input type="range" min={5} max={200} step={5} value={active.params.widthM} onChange={(e) => updParams({ widthM: +e.target.value })} /></Field>
                : <Field label={`Emprise : ${active.params.scalePct} % du tracé`} tip="Réduit ou agrandit le polygone dessiné autour de son centre, pour tester une variante de taille."><input type="range" min={25} max={300} step={5} value={active.params.scalePct} onChange={(e) => updParams({ scalePct: +e.target.value })} /></Field>}
              <Field label={`Rayon d'influence indirecte : ${active.params.radiusM} m`} tip="Distance jusqu'à laquelle bruit, lumière et fragmentation sont supposés perturber la faune et la flore. L'effet décroît avec la distance."><input type="range" min={0} max={5000} step={50} value={active.params.radiusM} onChange={(e) => updParams({ radiusM: +e.target.value })} /></Field>
              <Field label="Phase" tip="Le chantier et l'exploitation n'ont pas les mêmes coefficients (cf. Méthode et limites).">
                <select value={active.params.phase} onChange={(e) => updParams({ phase: e.target.value as Phase })}><option value="construction">Chantier</option><option value="operation">Exploitation</option></select>
              </Field>
              {active.comp
                ? <p>Compensation : <b>{activeEff.params.compensationPct} %</b> de l'emprise (zone dessinée, étape 1).</p>
                : <Field label={`Compensation : ${active.params.compensationPct} % d'emprise restaurée`} tip={`Réduit l'impact direct. Efficacité supposée à 100 % : ${cfg.compensationEfficiency * 100} % (une restauration ne vaut pas l'habitat existant). Ou dessinez la zone à l'étape 1.`}><input type="range" min={0} max={100} step={5} value={active.params.compensationPct} onChange={(e) => updParams({ compensationPct: +e.target.value })} /></Field>}
              <div className="live" aria-live="polite">{activeRes ? <>Score : <b>{fmt(activeRes.score)}</b> / 100 · {activeRes.speciesAffected} espèces · {activeRes.threatenedAffected} menacées (min.)</> : 'Définissez une zone (étape 1) pour calculer.'}</div>
              <button className="primary" onClick={() => goStep(3)}>Continuer : comparer →</button>
            </>}
          </section>}

          {step === 3 && <section aria-labelledby="s3">
            <h2 id="s3">3. Scénarios et rapport</h2>
            <ul className="scn-list">
              {scenarios.map((s) => <li key={s.id} className={s.id === activeId ? 'on' : ''}>
                <button className="scn-name" onClick={() => setActiveId(s.id)}><span className="dot" style={{ background: colorOf(scenarios, s.id) }} />{s.name}<small>{s.id === BASELINE_ID ? 'référence' : results[s.id] ? `score ${fmt(results[s.id]!.score)}` : 'sans zone'}</small></button>
                {s.id !== BASELINE_ID && <button onClick={() => remove(s.id)} aria-label={`Supprimer ${s.name}`}>🗑</button>}
              </li>)}
            </ul>
            <div className="btns"><button onClick={() => addScenario(true)} disabled={isBase}>Dupliquer</button><button onClick={() => addScenario(false)}>Nouveau</button></div>
            <p className="hint">Pour une variante : dupliquez, puis modifiez la zone (étape 1) ou le projet (étape 2).</p>
            <h3>Rapport</h3>
            <div className="btns">
              <button className="primary" disabled={!projectsReady} onClick={() => setView('report')}>Afficher le rapport</button>
              <button disabled={!projectsReady} onClick={() => openReport(reportHtml())}>Imprimer / PDF</button>
              <button disabled={!projectsReady} onClick={() => download('rapport-biodiversite.html', reportHtml(), 'text/html')}>Export HTML</button>
              <button onClick={() => download('scenarios.json', JSON.stringify({ exportedAt: new Date().toISOString(), weights, scenarios: scEff.map((s) => ({ ...s, result: results[s.id] ? { ...results[s.id], cells: undefined, species: undefined } : null })) }, null, 2), 'application/json')}>Export JSON</button>
            </div>
            <p className="hint">Sauvegarde automatique dans ce navigateur (localStorage).</p>
          </section>}
          </>}
        </aside>

        <div className="stage">
          <MapView grid={loaded.grid} gridVisible={showGrid || (sim && mode === 'impact')} prop={metricDef.prop} breaks={breaks} mode={sim && mode === 'impact' && activeRes && !isBase ? 'impact' : 'bio'} impact={impactFC} impactBreaks={impactBreaks} shapes={shapes} zone={zone}
            obs={obsPoints} obsVisible={showObs} drawMode={drawMode} editing={editingShape} fly={fly} onDrawn={onDrawn} onEdited={onEdited} onPickObs={(i) => obsStore && setPick({ id: obsStore.sp[i], obs: i })} onMapError={setMapMsg} />
          <div className="legend" aria-label="Légende">
            {sim && mode === 'impact' && activeRes && !isBase
              ? <><b>Impact local (relatif)</b><div className="ramp">{IMPACT_RAMP.map((c) => <i key={c} style={{ background: c }} />)}</div><div className="rl"><span>faible</span><span>fort</span></div><small>Pointillés : rayon d'influence</small></>
              : <>{showGrid && <><b>{metricDef.label}</b><div className="ramp">{BIO_RAMP.map((c) => <i key={c} style={{ background: c }} />)}</div>
                <div className="rl"><span>≤ {breaks[0] ?? 1}</span><span>&gt; {breaks[breaks.length - 1] ?? 1}</span></div><small>Cellules ≈ 1 km². Vide = aucune donnée.</small></>}
                {showObs && <ul className="gl">{GROUP_IDS.map((g) => <li key={g}><span className="dot" style={{ background: GROUP_COLORS[g] }} />{GROUP_FR[g]}</li>)}</ul>}</>}
          </div>
          {sim && <div className="viewtabs"><button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>Carte</button><button className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>Classement</button><button className={view === 'report' ? 'on' : ''} disabled={!projectsReady} onClick={() => setView('report')}>Rapport</button></div>}
          {sim && view === 'compare' && <div className="overlay">
            <Ranking scenarios={scEff} ranking={ranking} weights={weights} setWeights={setWeights} results={results} data={data} />
            <Compare scenarios={scEff} results={results} refId={refId} setRefId={setRefId} />
            <ResultSheet key={active.id} scenario={active} result={results[active.id]} data={data} showImpactMap={() => { setMode('impact'); setView('map') }} />
          </div>}
          {sim && view === 'report' && <div className="overlay report">
            <div className="btns"><button onClick={() => openReport(reportHtml())}>Imprimer / PDF</button><button onClick={() => download('rapport-biodiversite.html', reportHtml(), 'text/html')}>Exporter en HTML</button></div>
            <iframe title="Rapport de comparaison" srcDoc={reportHtml()} />
          </div>}
        </div>
      </div>
      <footer>Sources : {meta.sources.map((s, i) => <span key={s.name}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> ({s.license})</span>)} — via data.public.lu. Fond de carte © OpenStreetMap contributors, OpenFreeMap. Écopoints : <button className="link" onClick={() => alert(ECOPOINTS_NOTE)}>non appliqués</button>.</footer>
      {method && <Method meta={meta} onClose={() => setMethod(false)} />}
    </div>
  )
}
