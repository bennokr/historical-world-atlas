# Cliopatria DuckDB-wasm Spatial Demo

An interactive historical world atlas powered by **DuckDB-wasm** and **Leaflet**,
visualising 5,400 years of polity boundaries (3400 BCE – 2024 CE) from the
[Cliopatria](https://seshat-db.com/core/world_map) dataset.

## Features

- **Time slider** — drag through history or press ▶ to animate at 50-year steps
- **In-browser SQL** — every map render is a live DuckDB spatial query; edit the
  SQL and run your own (Ctrl+Enter)
- **Spatial functions** — DuckDB's `spatial` extension gives you `ST_Area`,
  `ST_Intersects`, `ST_Union`, `ST_Distance`, and friends over the full dataset
- **Click/hover** — popups show polity name, date range, area, and Wikipedia link
- **GeoParquet backend** — cliopatria.parquet is served via HTTP and range-requested
  by DuckDB-wasm; only matching row-groups are downloaded per query

## Quick Start

```bash
cd demo
npm install
npm run dev        # opens http://localhost:5173
```

The first load takes ~10–15 s to:
1. Download and instantiate DuckDB-wasm (~4 MB)
2. Install the `spatial` extension (~8 MB, cached after first run)
3. Fetch the parquet file metadata from `public/cliopatria.parquet`

Subsequent queries are fast (< 200 ms typical).

## Example SQL Queries

Paste these into the SQL editor and press **Run ▶** (or Ctrl+Enter):

```sql
-- Largest empires in 500 CE
SELECT Name, ROUND(Area / 1e6, 1) AS Mkm2, Wikipedia
FROM read_parquet('cliopatria.parquet')
WHERE FromYear <= 500 AND ToYear >= 500
  AND (MemberOf = '' OR MemberOf IS NULL)
ORDER BY Area DESC LIMIT 10;
```

```sql
-- How many distinct polities existed per century?
SELECT (FromYear / 100) * 100 AS century, COUNT(DISTINCT Name) AS polities
FROM read_parquet('cliopatria.parquet')
WHERE MemberOf = '' OR MemberOf IS NULL
GROUP BY 1
ORDER BY 1;
```

```sql
-- Overlay: all polities that ever overlapped the Iberian peninsula
SELECT Name, MIN(FromYear) AS start, MAX(ToYear) AS end
FROM read_parquet('cliopatria.parquet')
WHERE ST_Intersects(
        geometry,
        ST_GeomFromText('POLYGON((-10 36, 3 36, 3 44, -10 44, -10 36))')
      )
GROUP BY Name
ORDER BY start;
```

```sql
-- GeoJSON of the Roman Empire at its greatest extent (117 CE)
SELECT Name, ST_AsGeoJSON(geometry) AS geom_json,
       ROUND(Area / 1e6, 2) AS area_Mkm2
FROM read_parquet('cliopatria.parquet')
WHERE Name = 'Roman Empire'
  AND FromYear <= 117 AND ToYear >= 117;
```

## Data

`public/cliopatria.parquet` is derived from the
[Seshat / Cliopatria GeoJSON](https://github.com/Seshat-Global-History-Databank/cliopatria)
dataset.  A `Color` column (hex, deterministic per polity name) was added at
conversion time using `hashlib.md5` → HSV colouring.

## Tech Stack

| Layer | Library |
|---|---|
| In-browser DB | [DuckDB-wasm](https://github.com/duckdb/duckdb-wasm) + spatial extension |
| Map | [Leaflet](https://leafletjs.com/) |
| Data format | [GeoParquet](https://geoparquet.org/) |
| Build | [Vite](https://vitejs.dev/) |
| Basemap | CartoDB Dark Matter |

## Design Inspirations

- **fgravin/overture-duckdb-wasm** — Vue + MapLibre + DuckDB-wasm query pattern
- **sunu/geoparquet-duckdb-deckgl-demo** — binary GeoParquet pipeline, HTTP
  range-request approach, Arrow-to-renderer direct path
