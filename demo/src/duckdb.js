/**
 * DuckDB-wasm initialization and query helpers.
 *
 * Design choices:
 * - Uses local bundle files (served from node_modules via Vite ?url imports)
 *   so no CDN round-trip is needed to start DuckDB.
 * - Installs the DuckDB `spatial` extension at startup for ST_* functions.
 * - Registers cliopatria.parquet via HTTP so DuckDB can range-request it.
 * - The parquet is kept on disk (not loaded into RAM) so row-group predicate
 *   push-down applies — only matching rows materialise geometry strings.
 */

import * as duckdb from '@duckdb/duckdb-wasm'
import duckdb_wasm_eh   from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import duckdb_wasm_mvp  from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import eh_worker        from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import mvp_worker       from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'

// Make URLs absolute so they resolve correctly from inside blob: worker contexts
function abs(url) { return new URL(url, window.location.href).href }

const LOCAL_BUNDLES = {
  mvp: { mainModule: abs(duckdb_wasm_mvp), mainWorker: abs(mvp_worker) },
  eh:  { mainModule: abs(duckdb_wasm_eh),  mainWorker: abs(eh_worker)  },
}

let _conn = null

/** Initialise DuckDB, install spatial extension, register the parquet file. */
export async function initDB(onStatus) {
  onStatus('Selecting DuckDB bundle…')

  const bundle = await duckdb.selectBundle(LOCAL_BUNDLES)

  // createWorker wraps the URL in a blob so it works under COOP/COEP isolation
  const worker = await duckdb.createWorker(bundle.mainWorker)
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
  const db = new duckdb.AsyncDuckDB(logger, worker)

  onStatus('Instantiating DuckDB-wasm…')
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)

  const conn = await db.connect()

  onStatus('Installing extensions…')
  // Install from our locally-hosted mirror so it works offline and in
  // sandboxed environments where extensions.duckdb.org is unreachable.
  // DuckDB fetches: {repo}/v{version}/{platform}/{ext}.duckdb_extension.wasm
  const extRepo = new URL('/duckdb_extensions', window.location.href).href
  await conn.query(`INSTALL parquet FROM '${extRepo}';`)
  await conn.query('LOAD parquet;')
  await conn.query(`INSTALL spatial FROM '${extRepo}';`)
  await conn.query('LOAD spatial;')

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
  ST_AsGeoJSON(geometry) AS geom_json
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
