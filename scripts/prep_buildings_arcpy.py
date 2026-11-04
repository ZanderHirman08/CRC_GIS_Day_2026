"""
Build the page data from ArcGIS Pro, one county layer at a time.

Input (one file geodatabase):
  - a county boundary layer with the 10 CRC counties
  - one footprint layer per county, named so the county is in the name,
    e.g. CRC_Camden_footprints, CRC_McIntosh_footprints

Output (in OUT_FOLDER, normally the repo's data folder):
  - counties/<county>.json   one file per county, read by the page when that county is picked
                             row = [class, prim_occ index, area m², long-side angle, x dm, y dm, rings]
  - index.json               small summary of every county (Stats tab, facts line, picker)

Each county layer is read and written on its own. Nothing is merged.

How to run, in ArcGIS Pro (no extra installs):
  1. Fill in SETTINGS below.
  2. Analysis tab > Python > Python Notebook (or Python Window), then run:
         exec(open(r"C:\\path\\to\\CRC_GIS_Day_2026\\scripts\\prep_buildings_arcpy.py").read())
     or from a command prompt:
         "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\scripts\\propy.bat" prep_buildings_arcpy.py
"""

import fnmatch
import json
import math
import os
import re

# ─────────────────────────── SETTINGS ───────────────────────────

GDB = r"C:\Users\YOU\Documents\ArcGIS\Projects\GISDay\GISDay.gdb"
COUNTY_LAYER = "CRC_County_Boundary"   # county boundaries inside GDB
COUNTY_FIELD = "NAME"                  # field with "Camden" or "Camden County"
FOOTPRINT_PATTERN = "CRC_*_footprints" # * = the county name (case doesn't matter)

CLASS_FIELD = "OCC_CLS"
PRIM_FIELD = "PRIM_OCC"
AREA_FIELD = "SQMETERS"                # footprint area in m²; the shape's area is used if blank
LAND_FIELD = "ALAND"                   # county land area in m² (county layer); shape area if blank

OUT_FOLDER = r"C:\path\to\CRC_GIS_Day_2026\data"

SIMPLIFY_M = 0.5      # outline simplification in metres

# ────────────────────────────────────────────────────────────────

CRS_WKID = 6346  # NAD83(2011) / UTM zone 17N, metres
CLASSES = ["Residential", "Commercial", "Industrial", "Government", "Education",
           "Agriculture", "Assembly", "Utility and Misc", "Unclassified"]
UNCLASSIFIED = len(CLASSES) - 1
ALIASES = {"utility": 7, "utilities": 7, "misc": 7, "utility & misc": 7, "utility and miscellaneous": 7,
           "agricultural": 5, "govt": 3, "educational": 4, "res": 0, "unknown": 8, "": 8}
SQFT = 10.7639
SIZE_BINS = [0, 500 / SQFT, 2000 / SQFT, 10000 / SQFT, 100000 / SQFT, float("inf")]  # ft² bins in m²


# ── plain-Python helpers (no arcpy) ─────────────────────────────

def log(msg):
    print(msg)
    try:
        import arcpy
        arcpy.AddMessage(msg)
    except Exception:
        pass


def squash(s):
    """'McIntosh County' -> 'mcintoshcounty' for loose name matching."""
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def clean_county_name(s):
    return re.sub(r"\s+county$", "", str(s).strip(), flags=re.I).strip()


def norm_class(v):
    if v is None:
        return UNCLASSIFIED
    s = str(v).strip().lower()
    for i, c in enumerate(CLASSES):
        if s == c.lower():
            return i
    return ALIASES.get(s, UNCLASSIFIED)


def convex_hull(points):
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def long_axis_angle(points):
    """Angle (radians) of the long side of the minimum-area rotated rectangle."""
    hull = convex_hull(points)
    if len(hull) < 3:
        if len(hull) == 2:
            return math.atan2(hull[1][1] - hull[0][1], hull[1][0] - hull[0][0])
        return 0.0
    best = None
    n = len(hull)
    for i in range(n):
        x1, y1 = hull[i]
        x2, y2 = hull[(i + 1) % n]
        th = math.atan2(y2 - y1, x2 - x1)
        c, s = math.cos(th), math.sin(th)
        us = [c * x + s * y for x, y in hull]
        vs = [-s * x + c * y for x, y in hull]
        w, h = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * h < best[0]:
            best = (w * h, th if w >= h else th + math.pi / 2)
    a = best[1]
    while a > math.pi:
        a -= 2 * math.pi
    while a <= -math.pi:
        a += 2 * math.pi
    return a


def pack_rings(rings, cx, cy):
    """Rings of (x, y) metres -> flat integer lists in decimetres relative to (cx, cy)."""
    out = []
    for ring in rings:
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3:
            continue
        flat = []
        for x, y in ring:
            flat.append(int(round((x - cx) * 10)))
            flat.append(int(round((y - cy) * 10)))
        out.append(flat)
    return out


def summarize(name, slug, recs, land_area, prim_names):
    """recs: list of dicts with cls, prim, area (already sorted largest first)."""
    n = len(recs)
    areas = [r["area"] for r in recs]
    tot = sum(areas)
    tc = [0] * len(CLASSES)
    ta = [0.0] * len(CLASSES)
    for r in recs:
        tc[r["cls"]] += 1
        ta[r["cls"]] += r["area"]
    sc = [0] * (len(SIZE_BINS) - 1)
    sa = [0.0] * (len(SIZE_BINS) - 1)
    for a in areas:
        for k in range(len(SIZE_BINS) - 1):
            if SIZE_BINS[k] <= a < SIZE_BINS[k + 1]:
                sc[k] += 1
                sa[k] += a
                break
    k1 = max(1, math.ceil(n * 0.01)) if n else 0
    top1 = sum(areas[:k1]) / tot if tot else 0.0
    small_half = sum(areas[n // 2:]) / tot if tot else 0.0
    srt = sorted(areas)
    median = (srt[n // 2] if n % 2 else (srt[n // 2 - 1] + srt[n // 2]) / 2) if n else 0
    top = [[r["prim"], r["cls"], round(r["area"])] for r in recs[:10]]
    return dict(slug=slug, name=name, count=n, foot=round(tot), land=round(land_area),
                tc=tc, ta=[round(v) for v in ta], sc=sc, sa=[round(v) for v in sa],
                top1=round(top1, 4), smallHalf=round(small_half, 4), median=round(median, 1),
                top=top)


# ── arcpy part ──────────────────────────────────────────────────

def geom_rings(shape):
    """All rings (outer + holes) of a polygon geometry as lists of (x, y)."""
    rings = []
    for part in shape:
        ring = []
        for pt in part:
            if pt is None:          # None separates an outer ring from its holes
                if ring:
                    rings.append(ring)
                ring = []
            else:
                ring.append((pt.X, pt.Y))
        if ring:
            rings.append(ring)
    return rings


def find_field(fc, name):
    import arcpy
    if not name:
        return None
    for f in arcpy.ListFields(fc):
        if f.name.lower() == name.lower():
            return f.name
    return None


def list_feature_classes():
    import arcpy
    arcpy.env.workspace = GDB
    fcs = list(arcpy.ListFeatureClasses() or [])
    for ds in arcpy.ListDatasets(feature_type="feature") or []:
        fcs += [os.path.join(ds, fc) for fc in (arcpy.ListFeatureClasses(feature_dataset=ds) or [])]
    return fcs


def main():
    import arcpy
    sr = arcpy.SpatialReference(CRS_WKID)
    os.makedirs(os.path.join(OUT_FOLDER, "counties"), exist_ok=True)

    # counties
    fcs = list_feature_classes()
    county_fc = next((f for f in fcs if os.path.basename(f).lower() == COUNTY_LAYER.lower()), None)
    if not county_fc:
        raise RuntimeError(f"County layer '{COUNTY_LAYER}' not found in {GDB}. Found: {fcs}")
    cfield = find_field(county_fc, COUNTY_FIELD)
    if not cfield:
        raise RuntimeError(f"Field '{COUNTY_FIELD}' not in {COUNTY_LAYER}: {[f.name for f in arcpy.ListFields(county_fc)]}")
    lfield = find_field(county_fc, LAND_FIELD)
    counties, land = {}, {}
    with arcpy.da.SearchCursor(county_fc, [cfield, lfield or "OID@", "SHAPE@"], spatial_reference=sr) as cur:
        for name, aland, shp in cur:
            if shp is None:
                continue
            name = clean_county_name(name)
            counties[name] = counties[name].union(shp) if name in counties else shp
            a = float(aland) if lfield and aland else shp.area
            land[name] = land.get(name, 0.0) + a
    log(f"{len(counties)} counties: {', '.join(sorted(counties))}")

    # match each footprint layer to a county by its name
    layers = [f for f in fcs if fnmatch.fnmatch(os.path.basename(f).lower(), FOOTPRINT_PATTERN.lower())]
    if not layers:
        raise RuntimeError(f"No layers match '{FOOTPRINT_PATTERN}'. Found: {fcs}")
    matched = {}
    for fc in layers:
        base = squash(os.path.basename(fc))
        hits = [c for c in counties if squash(c) in base]
        if not hits:
            log(f"  skipped {fc}: no county name found in the layer name")
            continue
        c = max(hits, key=len)
        if c in matched:
            raise RuntimeError(f"Two layers for {c}: {matched[c]} and {fc}")
        matched[c] = fc
    for c in counties:
        if c not in matched:
            log(f"  note: no footprint layer for {c}")

    # read every county (records kept small; PRIM_OCC names collected for one shared list)
    per_county = {}
    prim_set = set()
    unmatched = {}
    for cname, fc in sorted(matched.items()):
        f_cls = find_field(fc, CLASS_FIELD)
        if not f_cls:
            raise RuntimeError(f"'{CLASS_FIELD}' not found in {fc}")
        f_prim, f_area = find_field(fc, PRIM_FIELD), find_field(fc, AREA_FIELD)
        fields = [f_cls] + [f for f in (f_prim, f_area) if f] + ["SHAPE@"]
        ip = fields.index(f_prim) if f_prim else None
        ia = fields.index(f_area) if f_area else None

        recs = []
        skipped = 0
        with arcpy.da.SearchCursor(fc, fields, spatial_reference=sr) as cur:
            for row in cur:
                shp = row[-1]
                if shp is None or shp.area <= 0:
                    skipped += 1
                    continue
                area = row[ia] if ia is not None and row[ia] else shp.area
                cls = norm_class(row[0])
                if cls == UNCLASSIFIED and str(row[0]).strip().lower() not in ("unclassified", "none", ""):
                    unmatched[str(row[0])] = unmatched.get(str(row[0]), 0) + 1
                prim = (str(row[ip]).strip() if ip is not None and row[ip] is not None else "") or "Not specified"
                simple = shp.generalize(SIMPLIFY_M) if SIMPLIFY_M > 0 else shp
                rings = geom_rings(simple if simple and simple.area > 0 else shp)
                c = shp.centroid
                packed = pack_rings(rings, c.X, c.Y)
                if not packed:
                    skipped += 1
                    continue
                outer = [p for ring in rings[:1] for p in ring]
                recs.append(dict(cls=cls, prim=prim, area=float(area),
                                 ang=long_axis_angle(outer), cx=c.X, cy=c.Y, rings=packed))
                prim_set.add(prim)
        recs.sort(key=lambda r: -r["area"])
        per_county[cname] = recs
        log(f"  {cname}: {len(recs):,} buildings from {os.path.basename(fc)}"
            + (f" ({skipped} empty skipped)" if skipped else ""))
    if unmatched:
        log(f"OCC_CLS values counted as Unclassified: {unmatched}")

    prims = sorted(prim_set)
    pidx = {p: i for i, p in enumerate(prims)}

    # write one file per county
    summaries = []
    for cname in sorted(per_county):
        recs, shp = per_county[cname], counties[cname]
        ext = shp.extent
        x0, y0 = ext.XMin, ext.YMin
        rows = [[r["cls"], pidx[r["prim"]], round(r["area"], 1), round(r["ang"], 3),
                 int(round((r["cx"] - x0) * 10)), int(round((r["cy"] - y0) * 10)),
                 r["rings"]] for r in recs]
        outline = [[v for x, y in ring for v in (int(round(x - x0)), int(round(y - y0)))]
                   for ring in geom_rings(shp.generalize(20))]
        slug = slugify(cname)
        with open(os.path.join(OUT_FOLDER, "counties", f"{slug}.json"), "w") as f:
            json.dump(dict(slug=slug, name=cname, w=round(ext.XMax - x0), h=round(ext.YMax - y0),
                           outline=outline, b=rows), f, separators=(",", ":"))
        s = summarize(cname, slug, [dict(r, prim=pidx[r["prim"]]) for r in recs], land[cname], prims)
        summaries.append(s)
        log(f"  wrote {slug}.json: {s['count']:,} buildings, largest 1% = {s['top1'] * 100:.0f}% of footprint")

    # picker outlines in one shared frame (10 m units)
    used = [counties[c] for c in sorted(per_county)]
    X0 = min(g.extent.XMin for g in used); Y0 = min(g.extent.YMin for g in used)
    X1 = max(g.extent.XMax for g in used); Y1 = max(g.extent.YMax for g in used)
    pick = [dict(slug=slugify(c), name=c,
                 rings=[[v for x, y in ring for v in (int(round((x - X0) / 10)), int(round((y - Y0) / 10)))]
                        for ring in geom_rings(counties[c].generalize(150))])
            for c in sorted(per_county)]
    with open(os.path.join(OUT_FOLDER, "index.json"), "w") as f:
        json.dump(dict(classes=CLASSES, prims=prims, counties=summaries,
                       pick=dict(w=round((X1 - X0) / 10), h=round((Y1 - Y0) / 10), counties=pick)),
                  f, separators=(",", ":"))
    log(f"Done: {OUT_FOLDER}")


if __name__ == "__main__":
    main()
