/**
 * DuckDB-wasm initialization and query helpers.
 *
 * Design choices:
 * - Uses JSDelivr CDN bundles (no local worker files needed)
 * - Installs the DuckDB `spatial` extension at startup for ST_* functions
 * - Registers cliopatria.parquet via HTTP so DuckDB can range-request it
 * - The parquet is kept on disk (not loaded into RAM) so row-group predicate
 *   push-down applies — only matching rows materialise geometry strings
 */

import * as duckdb from '@duckdb/duckdb-wasm'

let _conn = null

/** Initialise DuckDB, install spatial extension, register the parquet file. */
export async function initDB(onStatus) {
  onStatus('Selecting DuckDB bundle…')

  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles()
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES)

  // Wrap the worker URL in a Blob so it survives Vite's module transform
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}")`], { type: 'text/javascript' })
  )
  const worker = new Worker(workerUrl)
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
  const db = new duckdb.AsyncDuckDB(logger, worker)

  onStatus('Instantiating DuckDB-wasm…')
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)

  const conn = await db.connect()

  onStatus('Installing spatial extension…')
  await conn.query('INSTALL spatial; LOAD spatial;')

  // Register the parquet so DuckDB can HTTP range-request it
  const parquetUrl = new URL('/cliopatria.parquet', window.location.href).href
  onStatus('Registering cliopatria.parquet…')
  await db.registerFileURL(
    'cliopatria.parquet',
    parquetUrl,
    duckdb.DuckDBDataProtocol.HTTP,
    false
  )

  _conn = conn
  onStatus('Ready')
  return conn
}

/**
 * Execute a SQL string and return { rows, numRows, duration }.
 * rows is an array of plain JS objects.
 */
export async function runSQL(sql) {
  if (!_conn) throw new Error('DuckDB not initialised')
  const t0 = performance.now()
  const arrowResult = await _conn.query(sql)
  const duration = Math.round(performance.now() - t0)

  // Materialise Arrow table → plain objects
  const schema = arrowResult.schema
  const rows = arrowResult.toArray().map(row => {
    const obj = {}
    schema.fields.forEach(f => {
      const val = row[f.name]
      // BigInt → Number for JSON-safe rendering
      obj[f.name] = typeof val === 'bigint' ? Number(val) : val
    })
    return obj
  })

  return { rows, numRows: arrowResult.numRows, duration }
}

/** Build the default temporal query for a given integer year. */
export function buildYearQuery(year) {
  return `-- Polities active in ${fmtYear(year)}
SELECT
  Name,
  FromYear,
  ToYear,
  ROUND(Area / 1e6, 2)              AS area_Mkm2,
  Color,
  Wikipedia,
  ST_AsGeoJSON(ST_GeomFromWKB(geometry)) AS geom_json
FROM read_parquet('cliopatria.parquet')
WHERE FromYear <= ${year}
  AND ToYear   >= ${year}
  AND (MemberOf = '' OR MemberOf IS NULL)
ORDER BY Area DESC
LIMIT 500;`
}

/** Format integer year as human-readable BCE/CE string. */
export function fmtYear(y) {
  if (y < 0) return `${Math.abs(y)} BCE`
  if (y === 0) return '1 CE'
  return `${y} CE`
}
