"""
Build data/ranks.json from the county files in data/counties/.

The page uses it to rank a selected building against every building in all
10 counties (overall and within its class). Plain Python 3, nothing to install.
prep_buildings_arcpy.py runs this automatically at the end; run it by hand only
if you change the county files some other way:

    python scripts/build_ranks.py            (from the repo folder)

ranks.json holds, for each OCC_CLS class, every building's footprint in all counties,
largest first, in 0.1 m² units and delta-encoded (each number is the drop from
the previous one) to keep the file small.
"""

import glob
import json
import os
import sys


def encode(areas):
    """Sort largest first and store each value as the drop from the previous one."""
    areas.sort(reverse=True)
    return [a if i == 0 else areas[i - 1] - a for i, a in enumerate(areas)]


def build_ranks(data_dir):
    index = json.load(open(os.path.join(data_dir, "index.json")))
    n_classes = len(index["classes"])
    by_class = [[] for _ in range(n_classes)]
    for path in sorted(glob.glob(os.path.join(data_dir, "counties", "*.json"))):
        with open(path) as f:
            d = json.load(f)
        for row in d["b"]:
            by_class[row[0]].append(int(round(row[2] * 10)))
    total = sum(len(a) for a in by_class)
    with open(os.path.join(data_dir, "ranks.json"), "w") as f:
        json.dump(dict(unit=0.1, classes=[encode(a) for a in by_class]), f, separators=(",", ":"))
    return total


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    data = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "data")
    n = build_ranks(data)
    print(f"wrote ranks.json for {n:,} buildings")
