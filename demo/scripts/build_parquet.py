#!/usr/bin/env python3
"""
Convert the Cliopatria GeoJSON to GeoParquet for DuckDB-wasm consumption.

Usage:
    pip install geopandas pyarrow
    python scripts/build_parquet.py [/path/to/cliopatria.geojson.zip]

Output:
    public/cliopatria.parquet

The script adds a `Color` column: a deterministic hex colour per polity name
derived from an MD5 hash, giving visually distinct fills on the map.
"""

import sys
import os
import colorsys
import hashlib
import geopandas as gpd

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), '..', '..', '..', 'cliopatria',
    'cliopatria.geojson.zip'
)
DEST = os.path.join(os.path.dirname(__file__), '..', 'public', 'cliopatria.parquet')


def name_to_color(name: str) -> str:
    """Deterministic HSV → hex colour for a polity name."""
    digest = int(hashlib.md5(name.encode()).hexdigest()[:8], 16)
    hue = (digest & 0x3FF) / 1023.0
    sat = 0.55 + ((digest >> 10) & 0x3) * 0.1
    val = 0.65 + ((digest >> 12) & 0x3) * 0.1
    r, g, b = colorsys.hsv_to_rgb(hue, sat, val)
    return '#{:02x}{:02x}{:02x}'.format(int(r * 255), int(g * 255), int(b * 255))


def main():
    print(f'Reading {SRC} …')
    gdf = gpd.read_file(SRC)
    print(f'  {len(gdf):,} features, columns: {list(gdf.columns)}')

    gdf['Color'] = gdf['Name'].apply(name_to_color)

    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    print(f'Writing {DEST} …')
    gdf.to_parquet(DEST, index=False)

    size_mb = os.path.getsize(DEST) / 1024 / 1024
    print(f'Done — {size_mb:.1f} MB')


if __name__ == '__main__':
    main()
