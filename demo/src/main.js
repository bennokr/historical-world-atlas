/**
 * Cliopatria DuckDB-wasm Demo
 *
 * Architecture:
 * - DuckDB-wasm with spatial extension queries cliopatria.parquet in-browser
 * - Leaflet renders results as coloured GeoJSON polygons
 * - Year slider triggers SQL queries that filter by FromYear/ToYear
 * - SQL editor exposes the live query; users can edit and re-run any SQL
 *
 * Inspired by:
 *   fgravin/overture-duckdb-wasm   – Vue + MapLibre + DuckDB-wasm pattern
 *   sunu/geoparquet-duckdb-deckgl-demo – binary GeoParquet pipeline ideas
 */

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { initDB, runSQL, buildYearQuery, fmtYear } from './duckdb.js'

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $yearSlider   = document.getElementById('year-slider')
const $yearLabel    = document.getElementById('year-label')
const $playBtn      = document.getElementById('play-btn')
const $statusIcon   = document.getElementById('status-icon')
const $statusText   = document.getElementById('status-text')
const $sqlEditor    = document.getElementById('sql-editor')
const $runBtn       = document.getElementById('run-btn')
const $resetQueryBtn= document.getElementById('reset-query-btn')
const $queryDuration= document.getElementById('query-duration')
const $queryError   = document.getElementById('query-error')
const $resultsCount = document.getElementById('results-count')
const $resultsContent= document.getElementById('results-content')
const $toggleSchema = document.getElementById('toggle-schema-btn')
const $schemaContent= document.getElementById('schema-content')

// ─── State ────────────────────────────────────────────────────────────────────
let isReady    = false
let isPlaying  = false
let playTimer  = null
let geoLayer   = null
let currentYear = -3400
let lastQueryRows = []

const PLAY_STEP_MS  = 120   // ms between animation frames
const PLAY_YEAR_STEP = 50   // years advanced per frame

// ─── Map setup ────────────────────────────────────────────────────────────────
const map = L.map('map', { center: [20, 10], zoom: 2, zoomControl: true })

// Dark CartoDB basemap suits a historical aesthetic
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
    '© <a href="https://carto.com/attributions">CARTO</a> | ' +
    'Cliopatria © <a href="https://seshat-db.com/">Seshat</a>',
  maxZoom: 18,
  subdomains: 'abcd',
}).addTo(map)

// Light label layer on top so country names show through the polygons
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
  maxZoom: 18,
  subdomains: 'abcd',
  pane: 'shadowPane',  // renders above polity fills, below markers
}).addTo(map)

// ─── Status helpers ───────────────────────────────────────────────────────────
function setStatus(msg, type = 'info') {
  $statusText.textContent = msg
  $statusIcon.textContent = type === 'ok' ? '✓' : type === 'error' ? '✗' : '⏳'
  $statusIcon.style.color = type === 'ok' ? '#4caf50' : type === 'error' ? '#f44336' : '#ffb74d'
}

function setQueryError(msg) {
  $queryError.textContent = msg
  $queryDuration.textContent = ''
}

function clearQueryError() {
  $queryError.textContent = ''
}

// ─── Year helpers ─────────────────────────────────────────────────────────────
function updateYearLabel(y) {
  $yearLabel.textContent = fmtYear(y)
}

// ─── Map rendering ────────────────────────────────────────────────────────────
function renderFeatures(rows) {
  if (geoLayer) {
    map.removeLayer(geoLayer)
    geoLayer = null
  }

  const features = []
  for (const row of rows) {
    if (!row.geom_json) continue
    let geom
    try { geom = JSON.parse(row.geom_json) } catch { continue }
    features.push({
      type: 'Feature',
      geometry: geom,
      properties: {
        Name:      row.Name,
        FromYear:  row.FromYear,
        ToYear:    row.ToYear,
        area_Mkm2: row.area_Mkm2,
        Color:     row.Color,
        Wikipedia: row.Wikipedia,
      },
    })
  }

  if (features.length === 0) return

  geoLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: f => ({
      color:       lighten(f.properties.Color, 0.3),
      fillColor:   f.properties.Color,
      fillOpacity: 0.45,
      weight:      0.8,
      opacity:     0.9,
    }),
    onEachFeature(feature, layer) {
      const p = feature.properties
      const wikiLink = p.Wikipedia
        ? `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(p.Wikipedia)}"
              target="_blank" rel="noopener">Wikipedia ↗</a>`
        : ''
      layer.bindPopup(
        `<div class="popup">
           <strong>${p.Name}</strong>
           <div class="popup-years">${fmtYear(p.FromYear)} – ${fmtYear(p.ToYear)}</div>
           <div class="popup-area">${p.area_Mkm2 != null ? p.area_Mkm2 + ' million km²' : ''}</div>
           ${wikiLink}
         </div>`,
        { maxWidth: 240 }
      )
      layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.72, weight: 1.5 }))
      layer.on('mouseout',  () => layer.setStyle({ fillOpacity: 0.45, weight: 0.8 }))
    },
  }).addTo(map)
}

/** Lighten a hex colour by mixing with white (factor 0–1). */
function lighten(hex, factor) {
  if (!hex || hex.length < 7) return '#ffffff'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lr = Math.round(r + (255 - r) * factor)
  const lg = Math.round(g + (255 - g) * factor)
  const lb = Math.round(b + (255 - b) * factor)
  return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`
}

// ─── Results table ────────────────────────────────────────────────────────────
function renderResultsTable(rows) {
  if (rows.length === 0) {
    $resultsContent.innerHTML = '<p class="hint">No results.</p>'
    $resultsCount.textContent = '0'
    return
  }

  // Use all columns except geom_json
  const cols = Object.keys(rows[0]).filter(c => c !== 'geom_json')
  const display = rows.slice(0, 200)  // cap for DOM performance

  const thead = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`
  const tbody = display.map(row =>
    `<tr>${cols.map(c => {
      const v = row[c]
      if (c === 'Wikipedia' && v) {
        return `<td><a href="https://en.wikipedia.org/wiki/${encodeURIComponent(v)}" target="_blank" rel="noopener">${v}</a></td>`
      }
      if (c === 'Color' && v) {
        return `<td><span class="color-chip" style="background:${v}"></span>${v}</td>`
      }
      return `<td>${v ?? ''}</td>`
    }).join('')}</tr>`
  ).join('')

  $resultsContent.innerHTML =
    `<div class="table-scroll"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`
  $resultsCount.textContent = `${rows.length}`
}

// ─── Query execution ──────────────────────────────────────────────────────────
async function executeQuery(sql) {
  clearQueryError()
  $queryDuration.textContent = 'Running…'
  try {
    const { rows, numRows, duration } = await runSQL(sql)
    $queryDuration.textContent = `${numRows} rows · ${duration} ms`
    lastQueryRows = rows

    // Render map only if geom_json is present
    if (rows.length > 0 && 'geom_json' in rows[0]) {
      renderFeatures(rows)
    }
    renderResultsTable(rows)
  } catch (err) {
    setQueryError(err.message)
    console.error(err)
  }
}

async function queryForYear(year) {
  const sql = buildYearQuery(year)
  $sqlEditor.value = sql
  setStatus(`Querying ${fmtYear(year)}…`)
  try {
    const { rows, numRows, duration } = await runSQL(sql)
    $queryDuration.textContent = `${numRows} polities · ${duration} ms`
    clearQueryError()
    renderFeatures(rows)
    renderResultsTable(rows)
    setStatus(`${numRows} polities in ${fmtYear(year)}`, 'ok')
  } catch (err) {
    setQueryError(err.message)
    setStatus('Query error', 'error')
    console.error(err)
  }
}

// ─── Animation ────────────────────────────────────────────────────────────────
function startPlay() {
  isPlaying = true
  $playBtn.textContent = '⏸'
  $playBtn.title = 'Pause'
  step()
}

function stopPlay() {
  isPlaying = false
  clearTimeout(playTimer)
  $playBtn.textContent = '▶'
  $playBtn.title = 'Animate through time'
}

function step() {
  if (!isPlaying) return
  let y = currentYear + PLAY_YEAR_STEP
  if (y > 2024) y = -3400
  currentYear = y
  $yearSlider.value = y
  updateYearLabel(y)
  queryForYear(y).then(() => {
    if (isPlaying) playTimer = setTimeout(step, PLAY_STEP_MS)
  })
}

// ─── Event listeners ──────────────────────────────────────────────────────────
$yearSlider.addEventListener('input', () => {
  const y = parseInt($yearSlider.value, 10)
  currentYear = y
  updateYearLabel(y)
})

$yearSlider.addEventListener('change', () => {
  stopPlay()
  queryForYear(currentYear)
})

$playBtn.addEventListener('click', () => {
  if (isPlaying) stopPlay()
  else startPlay()
})

$runBtn.addEventListener('click', () => {
  stopPlay()
  executeQuery($sqlEditor.value.trim())
})

$sqlEditor.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    stopPlay()
    executeQuery($sqlEditor.value.trim())
  }
  // Allow Tab key for indentation
  if (e.key === 'Tab') {
    e.preventDefault()
    const { selectionStart: s, selectionEnd: e2, value } = $sqlEditor
    $sqlEditor.value = value.slice(0, s) + '  ' + value.slice(e2)
    $sqlEditor.selectionStart = $sqlEditor.selectionEnd = s + 2
  }
})

$resetQueryBtn.addEventListener('click', () => {
  $sqlEditor.value = buildYearQuery(currentYear)
})

// Schema panel toggle
$toggleSchema.addEventListener('click', () => {
  const hidden = $schemaContent.style.display === 'none'
  $schemaContent.style.display = hidden ? '' : 'none'
  $toggleSchema.textContent = hidden ? '▾' : '▸'
})

// ─── Boot ─────────────────────────────────────────────────────────────────────
;(async () => {
  try {
    await initDB(msg => setStatus(msg))

    isReady = true
    $yearSlider.disabled  = false
    $playBtn.disabled     = false
    $runBtn.disabled      = false
    $sqlEditor.disabled   = false
    $sqlEditor.placeholder = 'Write SQL here… (Ctrl+Enter to run)'

    // Show default year
    $sqlEditor.value = buildYearQuery(currentYear)
    await queryForYear(currentYear)
  } catch (err) {
    setStatus(`Failed to initialise: ${err.message}`, 'error')
    console.error(err)
  }
})()
