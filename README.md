# CRC GIS Day 2026

Web page: building footprints for the CRC counties, on the map and sorted by size,
colored by `OCC_CLS`.

## Files

```
index.html               page
assets/config.js         all text, colors and defaults (edit this)
assets/app.js            drawing, sorting, stats, poster export
assets/style.css         layout
scripts/prep_buildings_arcpy.py  builds data/ from the footprints (ArcGIS Pro)
data/                    generated: index.json, ranks.json + counties/<slug>.json
scripts/build_ranks.py   rebuilds data/ranks.json from the county files (plain Python)
```

## Build the data (ArcGIS Pro)

`scripts/prep_buildings_arcpy.py` runs in ArcGIS Pro's own Python; nothing to install.

1. Open the script and fill in the SETTINGS block: `GDB` (your file geodatabase) and
   `OUT_FOLDER` (this repo's `data` folder). Layer and field names default to
   `CRC_County_Boundary` (`NAME`, `ALAND`) and `CRC_*_footprints` (`OCC_CLS`, `PRIM_OCC`, `SQMETERS`).
2. In Pro: Analysis > Python > Python Window (or a Notebook), then run
   `exec(open(r"C:\path\to\CRC_GIS_Day_2026\scripts\prep_buildings_arcpy.py").read())`
3. Commit and push the `data` folder.

Each county layer is processed on its own and written to `data/counties/<county>.json`;
the county comes from the layer name. `data/index.json` holds the per-county summaries.
`data/ranks.json` (every building's size across all counties) powers the CRC-wide ranks shown when you click a building.
The script prints any `OCC_CLS` values it couldn't match ("Unclassified").

## Preview

```sh
python -m http.server 8000
```

then open http://localhost:8000. (Opening `index.html` directly won't load the data files.)

## Publish

Settings → Pages → deploy from the branch, root folder.
