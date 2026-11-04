"""
Water layers for the map: Census TIGER/Line area and linear hydrography.

Input
  - WATER_FOLDER: a folder (subfolders are fine) with the unzipped TIGER shapefiles
    for the 10 counties, named like the Census names them:
        tl_2024_13051_areawater.shp     (ocean, sounds, rivers, lakes as polygons)
        tl_2024_13051_linearwater.shp   (streams and rivers as lines)
    The 5-digit number is the county GEOID; any year works.
  - The same county boundary layer the buildings script uses (for the map frame).

Output (in OUT_FOLDER, normally the repo's data folder)
  - water/<county>.json   water polygons and named river lines for each county, in
                          the same frame as data/counties/<county>.json

Run it in ArcGIS Pro's Python window (nothing to install):
    exec(open(r"C:\\path\\to\\CRC_GIS_Day_2026\\scripts\\prep_water_arcpy.py").read())
"""

import fnmatch
import json
import os
import re

# ─────────────────────────── SETTINGS ───────────────────────────

WATER_FOLDER = r"C:\path\to\TIGER_water"
GDB = r"C:\Users\YOU\Documents\ArcGIS\Projects\GISDay\GISDay.gdb"
COUNTY_LAYER = "CRC_County_Boundary"
COUNTY_FIELD = "NAME"
GEOID_FIELD = "GEOID"
OUT_FOLDER = r"C:\path\to\CRC_GIS_Day_2026\data"

# Rivers drawn as lines: LINEARWATER features whose name contains one of these words.
# TIGER abbreviates most names ("Ogeechee Riv"), so both spellings are listed.
# Small creeks ("Crk") are left out.
RIVER_WORDS = ["River", "Riv"]

MIN_WATER_AREA = 2000   # m²; drops ponds smaller than this
SIMPLIFY_M = 4          # outline simplification in metres

# ────────────────────────────────────────────────────────────────

CRS_WKID = 6346  # NAD83(2011) / UTM zone 17N, same as the buildings


def log(msg):
    print(msg)
    try:
        import arcpy
        arcpy.AddMessage(msg)
    except Exception:
        pass


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def clean_county_name(s):
    return re.sub(r"\s+county$", "", str(s).strip(), flags=re.I).strip()


def geom_rings(shape):
    """Rings of a polygon (outer + holes) or parts of a polyline, as lists of (x, y)."""
    rings = []
    for part in shape:
        ring = []
        for pt in part:
            if pt is None:
                if ring:
                    rings.append(ring)
                ring = []
            else:
                ring.append((pt.X, pt.Y))
        if ring:
            rings.append(ring)
    return rings


def flat(ring, x0, y0, closed):
    if closed and len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(ring) < (3 if closed else 2):
        return None
    out = []
    for x, y in ring:
        out.append(int(round(x - x0)))
        out.append(int(round(y - y0)))
    return out


def find_files(folder, suffix):
    found = {}
    for root, _, files in os.walk(folder):
        for f in files:
            if fnmatch.fnmatch(f.lower(), f"*_{suffix}.shp"):
                m = re.search(r"_(\d{5})_", f)
                if m:
                    found[m.group(1)] = os.path.join(root, f)
    return found


def main():
    import arcpy
    sr = arcpy.SpatialReference(CRS_WKID)
    arcpy.env.workspace = GDB

    # Same county frame as prep_buildings_arcpy.py: dissolved county shape, its extent
    county_fc = next((f for f in arcpy.ListFeatureClasses() or [] if f.lower() == COUNTY_LAYER.lower()), None)
    if not county_fc:
        raise RuntimeError(f"County layer '{COUNTY_LAYER}' not found in {GDB}")
    shapes, geoids = {}, {}
    with arcpy.da.SearchCursor(county_fc, [COUNTY_FIELD, GEOID_FIELD, "SHAPE@"], spatial_reference=sr) as cur:
        for name, geoid, shp in cur:
            if shp is None:
                continue
            name = clean_county_name(name)
            shapes[name] = shapes[name].union(shp) if name in shapes else shp
            geoids.setdefault(name, set()).add(str(geoid))

    areas_by_geoid = find_files(WATER_FOLDER, "areawater")
    lines_by_geoid = find_files(WATER_FOLDER, "linearwater")
    log(f"found {len(areas_by_geoid)} areawater and {len(lines_by_geoid)} linearwater files")

    os.makedirs(os.path.abspath(os.path.join(OUT_FOLDER, "water")), exist_ok=True)
    river_re = re.compile(r"\b(" + "|".join(re.escape(w) for w in RIVER_WORDS) + r")\b\.?", re.I)
    out_dir = os.path.abspath(os.path.join(OUT_FOLDER, "water"))
    log(f"writing to {out_dir}")
    for name in sorted(shapes):
        ext = shapes[name].extent
        x0, y0 = ext.XMin, ext.YMin
        areas, rivers = [], []
        for geoid in sorted(geoids[name]):
            path = areas_by_geoid.get(geoid)
            if path:
                with arcpy.da.SearchCursor(path, ["SHAPE@"], spatial_reference=sr) as cur:
                    for (shp,) in cur:
                        if shp is None or shp.area < MIN_WATER_AREA:
                            continue
                        g = shp.generalize(SIMPLIFY_M) or shp
                        poly = [r for r in (flat(ring, x0, y0, True) for ring in geom_rings(g)) if r]
                        if poly:
                            areas.append(poly)
            else:
                log(f"  {name}: no areawater file for GEOID {geoid}")
            path = lines_by_geoid.get(geoid)
            if path:
                fields = [f.name for f in arcpy.ListFields(path)]
                name_field = next((f for f in fields if f.upper() == "FULLNAME"), None)
                with arcpy.da.SearchCursor(path, [name_field, "SHAPE@"], spatial_reference=sr) as cur:
                    for fullname, shp in cur:
                        if shp is None or not fullname or not river_re.search(str(fullname)):
                            continue
                        g = shp.generalize(SIMPLIFY_M) or shp
                        for part in geom_rings(g):
                            line = flat(part, x0, y0, False)
                            if line:
                                rivers.append(line)
            else:
                log(f"  {name}: no linearwater file for GEOID {geoid}")
        slug = slugify(name)
        path = os.path.join(out_dir, f"{slug}.json")
        with open(path, "w") as f:
            json.dump(dict(slug=slug, areas=areas, rivers=rivers), f, separators=(",", ":"))
        log(f"  {name}: {len(areas)} water areas, {len(rivers)} river lines -> {path}")
    log("Done")


if __name__ == "__main__":
    main()
