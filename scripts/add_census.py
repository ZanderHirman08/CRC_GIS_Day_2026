"""
Add ACS county numbers to data/index.json for the facts line under the county name.

Put the data.census.gov CSV downloads in census/ or data/Census/ (either the
"table view" download or the "...-Data.csv" files) and run, from the repo folder
(plain Python 3, nothing to install):

    python scripts/add_census.py

Re-run it after prep_buildings_arcpy.py, which rewrites index.json.

Tables used (any that are present): B01003 population, B25001 housing units,
B25002 occupancy, B25003 tenure, B25024 units in structure, B25035 median year built,
B25077 median home value, B19013 median household income.
"""

import csv
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def county_slug(name):
    # "Chatham County, Georgia" -> "chatham"
    return slugify(re.sub(r"\s+county$", "", name.split(",")[0].strip(), flags=re.I))


def number(v):
    if v is None:
        return None
    v = str(v).replace(",", "").replace("+", "").strip()
    try:
        return float(v)
    except ValueError:
        return None     # e.g. "-", "(X)", "*****"


def read_table_view(path, rows, values):
    """data.census.gov 'table view' download: one row per variable, one column per county.
    The table ID comes from the file name (e.g. ACSDT5Y2018.B25024-....csv); row 1 is
    variable _001 (the total), row 2 is _002, and so on."""
    m = re.search(r"\b([BC]\d{5}[A-Z]?)\b", os.path.basename(path))
    if not m:
        print(f"  skipped {os.path.basename(path)}: no table ID in the file name")
        return 0
    table = m.group(1)
    head = rows[0]
    cols = [(i, county_slug(h.split("!!")[0])) for i, h in enumerate(head) if h.endswith("!!Estimate")]
    for r, row in enumerate(rows[1:], start=1):
        var = f"{table}_{r:03d}E"
        for i, slug in cols:
            if i < len(row):
                values.setdefault(slug, {})[var] = number(row[i])
    return len(cols)


def read_values(folder):
    """{slug: {"B01003_001E": 12345.0, ...}} from every census CSV in the folder."""
    values = {}
    files = sorted(glob.glob(os.path.join(folder, "**", "*.csv"), recursive=True))
    for path in files:
        with open(path, newline="", encoding="utf-8-sig") as f:
            rows = list(csv.reader(f))
        if rows and rows[0] and rows[0][0].strip().lower().startswith("label"):
            n = read_table_view(path, rows, values)
            print(f"read {os.path.basename(path)}: {n} counties (table view)")
            continue
        if not rows or "GEO_ID" not in rows[0] or "NAME" not in rows[0]:
            continue    # metadata/column-description files
        head = rows[0]
        gi, ni = head.index("GEO_ID"), head.index("NAME")
        n = 0
        for row in rows[1:]:
            if len(row) < len(head) or not row[gi].startswith("0500000US"):
                continue    # the second header row of labels, or a non-county row
            slug = county_slug(row[ni])
            d = values.setdefault(slug, {})
            for col, val in zip(head, row):
                if re.match(r"^[BC]\d{5}[A-Z]?_\d{3}E$", col):
                    d[col] = number(val)
            n += 1
        print(f"read {os.path.basename(path)}: {n} counties")
    return values


def summarize(v):
    g = lambda k: v.get(k)
    def share(parts, total):
        t = g(total)
        if not t or any(g(p) is None for p in parts):
            return None
        return round(sum(g(p) for p in parts) / t, 4)
    out = {
        "population": g("B01003_001E"),
        "housingUnits": g("B25001_001E"),
        "medianYearBuilt": g("B25035_001E"),
        "medianHomeValue": g("B25077_001E"),
        "medianIncome": g("B19013_001E"),
        "pctVacant": share(["B25002_003E"], "B25002_001E"),
        "pctOwner": share(["B25003_002E"], "B25003_001E"),
        "pctRenter": share(["B25003_003E"], "B25003_001E"),
        "pctSingleFamily": share(["B25024_002E", "B25024_003E"], "B25024_001E"),
        "pctMultiFamily": share([f"B25024_{i:03d}E" for i in range(4, 10)], "B25024_001E"),
        "pctMobileHome": share(["B25024_010E"], "B25024_001E"),
    }
    return {k: (int(x) if isinstance(x, float) and x.is_integer() else x) for k, x in out.items() if x is not None}


def main():
    if len(sys.argv) > 1:
        folders = [sys.argv[1]]
    else:   # census/ or data/Census (any capitalization)
        folders = [os.path.join(ROOT, d) for d in os.listdir(ROOT) if d.lower() == "census"]
        data = os.path.join(ROOT, "data")
        folders += [os.path.join(data, d) for d in os.listdir(data) if d.lower() == "census"]
    values = {}
    for folder in folders:
        for slug, v in read_values(folder).items():
            values.setdefault(slug, {}).update(v)
    path = os.path.join(ROOT, "data", "index.json")
    index = json.load(open(path))
    missing = []
    for c in index["counties"]:
        v = values.get(c["slug"])
        if not v:
            missing.append(c["name"])
            c.pop("census", None)
            continue
        c["census"] = summarize(v)
        print(f"  {c['name']}: {c['census']}")
    if missing:
        print("no census rows for:", ", ".join(missing))
    with open(path, "w") as f:
        json.dump(index, f, separators=(",", ":"))
    print("updated data/index.json")


if __name__ == "__main__":
    main()
