# CRC GIS Day 2026

Web page: building footprints for the CRC counties, on the map and sorted by size,
colored by `OCC_CLS`.

## Files

```
index.html               page
assets/config.js         all text, colors and defaults (edit this)
assets/app.js            drawing, sorting, stats, poster export
assets/style.css         layout
scripts/prep_buildings.py  builds data/ from the footprints
data/                    generated: index.json + counties/<slug>.json
```

## Build the data

Needs Python 3.9+ with `geopandas` (>= 0.14) and `shapely` (>= 2):

```sh
pip install geopandas pyogrio
python scripts/prep_buildings.py --buildings path/to/structures.gdb --layer Structures \
    --counties path/to/counties.shp --county-field NAME
```

- Repeat `--buildings` for one file per county, or read every matching layer from one geodatabase:
  `--buildings CRC.gdb --layer-pattern "CRC_*_footprints" --counties CRC.gdb --counties-layer CRC_Counties`
- Field names default to `OCC_CLS`, `PRIM_OCC`, `HEIGHT` (metres), `PROP_CITY`; change them with
  `--class-field`, `--prim-field`, `--height-field`, `--city-field` (`''` skips a field).
- `--only` picks the counties (default: the 10 CRC counties). `--min-area 15` drops footprints under 15 m².
- The script prints any `OCC_CLS` values it could not match; those go to "Unclassified".

## Preview

```sh
python -m http.server 8000
```

then open http://localhost:8000. (Opening `index.html` directly won't load the data files.)

## Publish

Settings → Pages → deploy from the branch, root folder.
