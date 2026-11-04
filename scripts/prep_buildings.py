"""
Coast, Sorted: prepare county building footprints for the web page.

Reads one building footprint layer (or several) and the county boundaries, assigns
every building to a CRC county, and writes:

  data/index.json              summaries for every county + the picker outlines
  data/counties/<slug>.json    one file per county with every footprint

Footprints are stored in decimetres in NAD83(2011) UTM 17N, relative to each
building's centre, so the page can draw them on the map and also lift them off
and pack them into rows at the same scale.

Expected fields (FEMA USA Structures schema; names are case-insensitive and can be
changed with the flags below):
  OCC_CLS    broad occupancy class (9 values)
  PRIM_OCC   detailed primary occupancy (~37 values)
  HEIGHT     building height in metres (optional)
  PROP_CITY  city name (optional)

Usage (any Python 3.9+ with geopandas >= 0.14 and shapely >= 2):

  python scripts/prep_buildings.py \
      --buildings "C:/GIS/CRC/Structures.gdb" --layer Structures \
      --counties  "C:/GIS/CRC/Counties.shp" --county-field NAME

  Several building files (one per county) are fine: repeat --buildings.

Install, if needed:  pip install geopandas pyogrio
(In ArcGIS Pro: clone the default environment in Package Manager and add geopandas.)
"""

import argparse
import json
import math
import os
import re
import sys

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

CRS = 6346  # NAD83(2011) / UTM zone 17N, metres

CRC_COUNTIES = ["Bryan", "Bulloch", "Camden", "Chatham", "Effingham",
                "Glynn", "Liberty", "Long", "McIntosh", "Screven"]

# Fixed order. The page assigns colours by this index, so keep it stable.
CLASSES = ["Residential", "Commercial", "Industrial", "Government", "Education",
           "Agriculture", "Assembly", "Utility and Misc", "Unclassified"]

SQFT = 10.7639


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--buildings", action="append", required=True,
                   help="Building footprints (gdb, gpkg, shp, geojson). Repeat for several files.")
    p.add_argument("--layer", default=None, help="Layer name inside a gdb/gpkg")
    p.add_argument("--counties", required=True, help="County boundaries")
    p.add_argument("--counties-layer", default=None)
    p.add_argument("--county-field", default="NAME", help="County name field (default NAME)")
    p.add_argument("--only", default=",".join(CRC_COUNTIES),
                   help="Comma-separated county names to keep (default: the 10 CRC counties)")
    p.add_argument("--class-field", default="OCC_CLS")
    p.add_argument("--prim-field", default="PRIM_OCC")
    p.add_argument("--height-field", default="HEIGHT", help="Height in metres; '' to skip")
    p.add_argument("--city-field", default="PROP_CITY", help="'' to skip")
    p.add_argument("--min-area", type=float, default=0.0,
                   help="Drop footprints smaller than this many square metres (e.g. 15 to drop sheds)")
    p.add_argument("--simplify", type=float, default=0.5, help="Simplify tolerance in metres")
    p.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
    return p.parse_args()


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def find_col(df, name):
    """Case-insensitive column lookup. Returns None for '' or a missing field."""
    if not name:
        return None
    for c in df.columns:
        if c.lower() == name.lower():
            return c
    return None


def norm_class(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return len(CLASSES) - 1
    s = str(v).strip().lower()
    for i, c in enumerate(CLASSES):
        if s == c.lower():
            return i
    # common variants
    aliases = {"utility": 7, "utilities": 7, "misc": 7, "utility & misc": 7, "utility and miscellaneous": 7,
               "agricultural": 5, "govt": 3, "educational": 4, "res": 0, "unknown": 8, "": 8}
    return aliases.get(s, len(CLASSES) - 1)


def rings_of(geom):
    polys = getattr(geom, "geoms", [geom])
    out = []
    for p in polys:
        if p.is_empty or p.geom_type != "Polygon":
            continue
        out.append(p.exterior)
        out.extend(p.interiors)
    return out


def long_axis_angle(geom):
    """Angle (radians) of the long side of the minimum rotated rectangle."""
    env = shapely.oriented_envelope(geom)
    if env.geom_type != "Polygon":
        return 0.0
    c = np.asarray(env.exterior.coords)
    e1, e2 = c[1] - c[0], c[2] - c[1]
    e = e1 if np.hypot(*e1) >= np.hypot(*e2) else e2
    return math.atan2(e[1], e[0])


def main():
    a = parse_args()
    keep = [s.strip() for s in a.only.split(",") if s.strip()]

    # ── counties ──
    cty = gpd.read_file(a.counties, layer=a.counties_layer)
    ncol = find_col(cty, a.county_field)
    if ncol is None:
        sys.exit(f"County field '{a.county_field}' not found. Fields: {list(cty.columns)}")
    cty = cty.to_crs(CRS)
    cty["cname"] = cty[ncol].astype(str).str.replace(r"\s+County$", "", regex=True).str.strip()
    if keep:
        lower = {k.lower() for k in keep}
        cty = cty[cty.cname.str.lower().isin(lower)]
    cty = cty.dissolve("cname").reset_index()[["cname", "geometry"]]
    if cty.empty:
        sys.exit("No counties left after filtering. Check --county-field and --only.")
    print(f"{len(cty)} counties: {', '.join(cty.cname)}")

    # ── buildings ──
    parts = []
    for path in a.buildings:
        g = gpd.read_file(path, layer=a.layer)
        print(f"read {len(g):,} features from {path}")
        parts.append(g.to_crs(CRS))
    b = pd.concat(parts, ignore_index=True)
    b = gpd.GeoDataFrame(b, geometry="geometry", crs=CRS)

    ccol, pcol = find_col(b, a.class_field), find_col(b, a.prim_field)
    hcol, tcol = find_col(b, a.height_field), find_col(b, a.city_field)
    if ccol is None:
        sys.exit(f"Class field '{a.class_field}' not found. Fields: {list(b.columns)}")
    print(f"fields: class={ccol} prim={pcol} height={hcol} city={tcol}")

    b = b[b.geometry.notna() & ~b.geometry.is_empty].copy()
    b["geometry"] = shapely.force_2d(shapely.make_valid(b.geometry.values))
    b = b[b.geometry.geom_type.isin(["Polygon", "MultiPolygon", "GeometryCollection"])]
    # GeometryCollections from make_valid: keep their polygon parts
    b["geometry"] = [shapely.union_all([p for p in getattr(g, "geoms", [g]) if p.geom_type in ("Polygon", "MultiPolygon")])
                     if g.geom_type == "GeometryCollection" else g for g in b.geometry]
    b = b[~b.geometry.is_empty]
    b["area"] = b.geometry.area
    if a.min_area > 0:
        before = len(b)
        b = b[b.area >= a.min_area]
        print(f"dropped {before - len(b):,} footprints under {a.min_area} m²")

    # ── assign to counties by a point inside each footprint ──
    pts = gpd.GeoDataFrame(geometry=b.geometry.representative_point(), index=b.index, crs=CRS)
    j = gpd.sjoin(pts, cty, predicate="within", how="inner")
    j = j[~j.index.duplicated()]
    b = b.loc[j.index].copy()
    b["cname"] = j.cname
    print(f"{len(b):,} buildings inside the selected counties")

    b["cls"] = b[ccol].map(norm_class).astype(int)
    b["prim"] = (b[pcol].fillna("").astype(str).str.strip() if pcol else "")
    b.loc[b.prim == "", "prim"] = "Not specified"
    b["h"] = pd.to_numeric(b[hcol], errors="coerce") if hcol else np.nan
    b["city"] = b[tcol].fillna("").astype(str).str.strip().str.title() if tcol else ""

    prims = sorted(b.prim.unique())
    pidx = {p: i for i, p in enumerate(prims)}
    raw = b[ccol].astype(str)
    unmatched = raw[(b.cls == len(CLASSES) - 1) & (raw.str.strip().str.lower() != "unclassified")].value_counts().head(8)
    if len(unmatched):
        print("values mapped to Unclassified:", unmatched.to_dict())

    b["geometry"] = b.geometry.simplify(a.simplify, preserve_topology=True)

    out_dir = os.path.abspath(a.out)
    os.makedirs(os.path.join(out_dir, "counties"), exist_ok=True)

    summaries = []
    for _, c in cty.sort_values("cname").iterrows():
        name, slug = c.cname, slugify(c.cname)
        s = b[b.cname == name].sort_values("area", ascending=False)
        x0, y0, x1, y1 = c.geometry.bounds
        cities = sorted({x for x in s.city if x})
        cityidx = {x: i for i, x in enumerate(cities)}

        rows = []
        for r in s.itertuples():
            cx, cy = r.geometry.centroid.x, r.geometry.centroid.y
            rings = []
            for ring in rings_of(r.geometry):
                xy = np.asarray(ring.coords)[:-1]
                if len(xy) < 3:
                    continue
                rings.append(np.round((xy - [cx, cy]) * 10).astype(int).ravel().tolist())
            if not rings:
                continue
            h = None if r.h != r.h else round(float(r.h), 1)
            rows.append([int(r.cls), pidx[r.prim], round(float(r.area), 1), h,
                         round(long_axis_angle(r.geometry), 3),
                         int(round((cx - x0) * 10)), int(round((cy - y0) * 10)),
                         cityidx.get(r.city, -1), rings])

        outline = [np.round(np.asarray(p.exterior.coords) - [x0, y0]).astype(int).ravel().tolist()
                   for p in getattr(c.geometry.simplify(20), "geoms", [c.geometry.simplify(20)])]
        with open(os.path.join(out_dir, "counties", f"{slug}.json"), "w") as f:
            json.dump(dict(slug=slug, name=name, w=round(x1 - x0), h=round(y1 - y0),
                           outline=outline, cities=cities, b=rows), f, separators=(",", ":"))

        # summary
        areas = s.area.to_numpy()
        n = len(areas)
        tot = float(areas.sum()) if n else 0.0
        tc = np.bincount(s.cls, minlength=len(CLASSES)).tolist()
        ta = np.round(np.bincount(s.cls, weights=s.area, minlength=len(CLASSES))).tolist()
        bins = [0, 500 / SQFT, 2000 / SQFT, 10000 / SQFT, 100000 / SQFT, 1e12]  # ft² bins in m²
        sc = np.histogram(areas, bins)[0].tolist()
        sa = np.round(np.histogram(areas, bins, weights=areas)[0]).tolist()
        k1 = max(1, int(math.ceil(n * 0.01))) if n else 0
        top1 = float(areas[:k1].sum() / tot) if tot else 0.0
        half = float(areas[n // 2:].sum() / tot) if tot else 0.0
        top = [[pidx[r.prim], int(r.cls), round(float(r.area)), r.city or ""] for r in s.head(10).itertuples()]
        summaries.append(dict(slug=slug, name=name, count=n, foot=round(tot), land=round(c.geometry.area),
                              tc=tc, ta=ta, sc=sc, sa=sa, top1=round(top1, 4), smallHalf=round(half, 4),
                              median=round(float(np.median(areas)), 1) if n else 0,
                              medh=None if s.h.isna().all() else round(float(s.h.median()), 1),
                              top=top))
        print(f"  {name}: {n:,} buildings, {tot / 1e6:.2f} km² of footprint, "
              f"largest 1% = {top1 * 100:.0f}% of footprint")

    X0, Y0, X1, Y1 = cty.total_bounds
    pick = []
    for _, c in cty.sort_values("cname").iterrows():
        g = c.geometry.simplify(150)
        pick.append(dict(slug=slugify(c.cname), name=c.cname,
                         rings=[np.round((np.asarray(p.exterior.coords) - [X0, Y0]) / 10).astype(int).ravel().tolist()
                                for p in getattr(g, "geoms", [g])]))
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(dict(classes=CLASSES, prims=prims, counties=summaries,
                       pick=dict(w=round((X1 - X0) / 10), h=round((Y1 - Y0) / 10), counties=pick)),
                  f, separators=(",", ":"))
    print(f"wrote {out_dir}")


if __name__ == "__main__":
    main()
