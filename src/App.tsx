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
import MapView, { BIO_RAMP, IMPACT_RAMP } from './components/MapView.tsx'
import type { DrawMode } from './components/MapView.tsx'
import Compare from './components/Compare.tsx'
import ResultSheet from './components/ResultSheet.tsx'
import Method from './components/Method.tsx'
import { Field, Tip } from './components/ui.tsx'
import { GROUP_FR, fmt } from './labels.ts'
import { GROUP_IDS } from './engine/types.ts'
import { buildReportHtml, download, openReport } from './report.ts'

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

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapMsg, setMapMsg] = useState<string | null>(null)
  const saved = useMemo(() => loadSaved(), [])
  const [scenarios, setScenarios] = useState<Scenario[]>(saved?.scenarios ?? [baseline(), { id: newId(), name: 'Scénario 1', shape: null, params: defaultParams('building') }])
  const [activeId, setActiveId] = useState(saved?.activeId ?? scenarios[1].id)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [view, setView] = useState<'map' | 'compare'>('map')
  const [metric, setMetric] = useState('sp')
  const [mode, setMode] = useState<'bio' | 'impact'>('bio')
  const [drawMode, setDrawMode] = useState<DrawMode>(null)
  const [method, setMethod] = useState(false)
  const [refId, setRefId] = useState('')
  const [saveOk, setSaveOk] = useState(true)

  useEffect(() => { loadAll().then(setLoaded).catch((e) => setError(String(e.message ?? e))) }, [])
  useEffect(() => { setSaveOk(save(scenarios, activeId)) }, [scenarios, activeId])

  const refs = useMemo(() => (loaded ? computeReferences(loaded.data.cells) : null), [loaded])
  const cache = useRef(new Map<string, SimulationResult>())
  const [calcError, setCalcError] = useState<string | null>(null)
  const results = useMemo(() => {
    const out: Record<string, SimulationResult | null> = {}
    if (!loaded || !refs) return out
    for (const s of scenarios) {
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
  }, [scenarios, loaded, refs])

  const active = scenarios.find((s) => s.id === activeId) ?? scenarios[0]
  const isBase = active.id === BASELINE_ID
  const upd = (patch: Partial<Scenario>) => setScenarios((l) => l.map((s) => (s.id === active.id ? { ...s, ...patch } : s)))
  const updParams = (patch: Partial<Scenario['params']>) => upd({ params: { ...active.params, ...patch } })
  const cfg = PRESETS[active.params.preset]

  const breaks = useMemo(() => (loaded ? quantiles(loaded.grid.features.map((f) => Number(f.properties?.[METRICS.find((m) => m.id === metric)!.prop] ?? 0))) : []), [loaded, metric])
  const activeRes = results[active.id]
  const impactFC = useMemo<FeatureCollection>(() => {
    if (!loaded || !activeRes) return emptyFC
    const byId = new Map(loaded.grid.features.map((f) => [String(f.properties?.id), f]))
    return { type: 'FeatureCollection', features: activeRes.cells.filter((c) => c.impact > 0).map((c) => ({ ...(byId.get(c.id) as Feature<Polygon>), properties: { impact: c.impact } })) }
  }, [loaded, activeRes])
  const impactBreaks = useMemo(() => { const m = Math.max(1e-9, ...impactFC.features.map((f) => f.properties!.impact as number)); return [0.1, 0.25, 0.5, 0.75].map((x) => x * m) }, [impactFC])
  const shapes = useMemo<FeatureCollection>(() => ({ type: 'FeatureCollection', features: scenarios.filter((s) => s.shape).map((s) => ({ ...(s.shape as Footprint), properties: { color: colorOf(scenarios, s.id), active: s.id === active.id } })) }), [scenarios, active.id])
  const zone = useMemo<FeatureCollection>(() => {
    if (!active.shape || active.params.radiusM <= 0) return emptyFC
    try { return { type: 'FeatureCollection', features: [turf.buffer(buildFootprint(active.shape, active.params), active.params.radiusM / 1000, { units: 'kilometers' })!] } } catch { return emptyFC }
  }, [active.shape, active.params])

  const onDrawn = (f: Footprint) => {
    if (isBase) return
    upd({ shape: f }); setDrawMode(null); setMode('impact'); setStep(2)
  }
  const addScenario = (dup: boolean) => {
    const n = scenarios.length
    const s: Scenario = dup && !isBase ? { ...structuredClone(active), id: newId(), name: `${active.name} (copie)` } : { id: newId(), name: `Scénario ${n}`, shape: null, params: defaultParams('building') }
    setScenarios((l) => [...l, s]); setActiveId(s.id)
  }
  const remove = (id: string) => {
    if (id === BASELINE_ID || !window.confirm('Supprimer ce scénario ?')) return
    setScenarios((l) => l.filter((s) => s.id !== id)); if (activeId === id) setActiveId(BASELINE_ID)
  }
  const goStep = (n: 1 | 2 | 3) => { setStep(n); setView(n === 3 ? 'compare' : 'map'); if (n !== 1) setDrawMode(null) }

  if (error) return <div className="state error" role="alert"><h1>Erreur de chargement des données</h1><p>{error}</p><p>Lancez <code>npm run build-data</code> puis rechargez la page.</p></div>
  if (!loaded) return <div className="state" role="status"><p>Chargement des données de biodiversité…</p></div>
  const { meta, data } = loaded
  const metricDef = METRICS.find((m) => m.id === metric)!
  const projectsReady = scenarios.filter((s) => s.id !== BASELINE_ID && results[s.id]).length

  return (
    <div className="app">
      <header>
        <h1>Digital Twin Biodiversité Luxembourg</h1>
        <p className="banner" role="note">Aide à la décision, ne remplace pas une étude d'impact. Indice heuristique, non prédictif.</p>
        <button onClick={() => setMethod(true)}>Méthode et limites</button>
      </header>
      {(mapMsg || calcError || !saveOk) && <div className="notice" role="alert">{mapMsg}{calcError}{!saveOk && ' Sauvegarde locale indisponible (navigateur) : exportez vos scénarios en JSON.'}</div>}
      <div className="main">
        <aside className="side">
          <nav className="steps" aria-label="Étapes">
            {([[1, 'Zone'], [2, 'Projet'], [3, 'Scénarios et comparaison']] as const).map(([n, l]) => <button key={n} className={step === n ? 'on' : ''} aria-current={step === n ? 'step' : undefined} onClick={() => goStep(n)}><span>{n}</span>{l}</button>)}
          </nav>

          <div className="scn-select">
            <Field label="Scénario actif"><select value={activeId} onChange={(e) => setActiveId(e.target.value)}>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>

          {step === 1 && <section aria-labelledby="s1">
            <h2 id="s1">1. Zone</h2>
            {isBase ? <p className="empty">Le scénario de référence n'a pas de zone. Choisissez ou créez un autre scénario.</p> : <>
              <p>Dessinez l'emprise du projet sur la carte pour « {active.name} ».</p>
              <div className="btns">
                <button className={drawMode === 'polygon' ? 'on' : ''} onClick={() => { setView('map'); setDrawMode(drawMode === 'polygon' ? null : 'polygon') }}>▱ Polygone</button>
                <button className={drawMode === 'rectangle' ? 'on' : ''} onClick={() => { setView('map'); setDrawMode(drawMode === 'rectangle' ? null : 'rectangle') }}>▭ Rectangle</button>
                <button className={drawMode === 'line' ? 'on' : ''} onClick={() => { setView('map'); setDrawMode(drawMode === 'line' ? null : 'line') }}>⟋ Ligne (route, voie ferrée)</button>
              </div>
              {drawMode && <p className="hint" role="status">{drawMode === 'line' ? 'Cliquez pour poser les points, double-clic (ou re-clic sur le dernier point) pour terminer.' : drawMode === 'rectangle' ? 'Cliquez deux coins opposés.' : 'Cliquez pour poser les sommets, double-clic (ou re-clic sur le dernier sommet) pour fermer.'}</p>}
              {active.shape && <p>✔ Zone définie ({activeRes ? `${fmt(activeRes.footprintHa)} ha` : '…'}). <button className="link" onClick={() => upd({ shape: null })}>Effacer</button></p>}
              {active.shape && <button className="primary" onClick={() => goStep(2)}>Continuer : définir le projet →</button>}
            </>}
            <h3>Couches de la carte</h3>
            <div className="btns"><button className={mode === 'bio' ? 'on' : ''} onClick={() => setMode('bio')}>Biodiversité</button><button className={mode === 'impact' ? 'on' : ''} disabled={!activeRes || isBase} onClick={() => setMode('impact')}>Impact du scénario</button></div>
            <Field label="Couche affichée" tip={metricDef.tip}>
              <select value={metric} onChange={(e) => { setMetric(e.target.value); setMode('bio') }}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            </Field>
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
              <Field label={`Compensation : ${active.params.compensationPct} % d'emprise restaurée`} tip={`Réduit l'impact direct. Efficacité supposée à 100 % : ${cfg.compensationEfficiency * 100} % (une restauration ne vaut pas l'habitat existant).`}><input type="range" min={0} max={100} step={5} value={active.params.compensationPct} onChange={(e) => updParams({ compensationPct: +e.target.value })} /></Field>
              <div className="live" aria-live="polite">{activeRes ? <>Score : <b>{fmt(activeRes.score)}</b> / 100 · {activeRes.speciesAffected} espèces affectées</> : 'Définissez une zone (étape 1) pour calculer.'}</div>
              <button className="primary" onClick={() => goStep(3)}>Continuer : scénarios →</button>
            </>}
          </section>}

          {step === 3 && <section aria-labelledby="s3">
            <h2 id="s3">3. Scénarios</h2>
            <ul className="scn-list">
              {scenarios.map((s) => <li key={s.id} className={s.id === activeId ? 'on' : ''}>
                <button className="scn-name" onClick={() => setActiveId(s.id)}><span className="dot" style={{ background: colorOf(scenarios, s.id) }} />{s.name}<small>{s.id === BASELINE_ID ? 'référence' : results[s.id] ? `score ${fmt(results[s.id]!.score)}` : 'sans zone'}</small></button>
                {s.id !== BASELINE_ID && <button onClick={() => remove(s.id)} aria-label={`Supprimer ${s.name}`}>🗑</button>}
              </li>)}
            </ul>
            <div className="btns"><button onClick={() => addScenario(true)} disabled={isBase}>Dupliquer</button><button onClick={() => addScenario(false)}>Nouveau</button></div>
            <p className="hint">Pour une variante : dupliquez, puis modifiez le projet (étape 2), la zone (étape 1) ou la compensation.</p>
            <h3>Export</h3>
            <div className="btns">
              <button disabled={!projectsReady} onClick={() => openReport(buildReportHtml(scenarios, results, meta))}>Rapport imprimable / PDF</button>
              <button disabled={!projectsReady} onClick={() => download('rapport-biodiversite.html', buildReportHtml(scenarios, results, meta), 'text/html')}>Rapport HTML</button>
              <button onClick={() => download('scenarios.json', JSON.stringify({ exportedAt: new Date().toISOString(), scenarios: scenarios.map((s) => ({ ...s, result: results[s.id] ? { ...results[s.id], cells: undefined, species: undefined } : null })) }, null, 2), 'application/json')}>Export JSON</button>
            </div>
            <p className="hint">Les scénarios sont sauvegardés automatiquement dans ce navigateur (localStorage).</p>
          </section>}
        </aside>

        <div className="stage">
          <MapView grid={loaded.grid} prop={metricDef.prop} breaks={breaks} mode={mode === 'impact' && activeRes && !isBase ? 'impact' : 'bio'} impact={impactFC} impactBreaks={impactBreaks} shapes={shapes} zone={zone} drawMode={drawMode} onDrawn={onDrawn} onMapError={setMapMsg} />
          <div className="legend" aria-label="Légende">
            {mode === 'impact' && activeRes && !isBase
              ? <><b>Impact local (relatif)</b><div className="ramp">{IMPACT_RAMP.map((c) => <i key={c} style={{ background: c }} />)}</div><div className="rl"><span>faible</span><span>fort</span></div><small>Pointillés : rayon d'influence</small></>
              : <><b>{metricDef.label}</b><div className="ramp">{BIO_RAMP.map((c) => <i key={c} style={{ background: c }} />)}</div>
                <div className="rl"><span>≤ {breaks[0] ?? 1}</span><span>&gt; {breaks[breaks.length - 1] ?? 1}</span></div><small>Cellules ≈ 1 km². Gris/absent = aucune donnée.</small></>}
          </div>
          <div className="viewtabs"><button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>Carte</button><button className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>Comparaison</button></div>
          {view === 'compare' && <div className="overlay">
            <Compare scenarios={scenarios} results={results} refId={refId} setRefId={setRefId} />
            <ResultSheet key={active.id} scenario={active} result={results[active.id]} data={data} showImpactMap={() => { setMode('impact'); setView('map') }} />
          </div>}
        </div>
      </div>
      <footer>Sources : {meta.sources.map((s, i) => <span key={s.name}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> ({s.license})</span>)} — via data.public.lu. Fond de carte © OpenStreetMap contributors, OpenFreeMap. Tooltip <Tip text="Les points « ? » donnent des explications." /></footer>
      {method && <Method meta={meta} onClose={() => setMethod(false)} />}
    </div>
  )
}
