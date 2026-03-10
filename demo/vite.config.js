import { defineConfig } from 'vite'

const ISOLATION_HEADERS = {
  // 'credentialless' allows cross-origin subresources (map tiles) without needing
  // CORP headers, while still enabling SharedArrayBuffer for DuckDB-wasm.
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

export default defineConfig({
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    headers: ISOLATION_HEADERS,
  },
  preview: {
    headers: ISOLATION_HEADERS,
  },
})
