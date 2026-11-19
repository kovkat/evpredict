"""Usable capacity, DC power and DC charging curves from Open EV Data.

Source: github.com/KilowattApp/open-ev-data, data/ev-data.json (MIT; attribution:
"Open EV Data by Chargeprice / KilowattApp"). Download the file and pass its path:
  python -I research/params/oed_vehicles.py /path/to/ev-data.json
Writes research/params/data/oed_vehicles.json (entries for the vehicle catalogue) and
research/params/results/charge_curve.json (generic normalized curve for vehicles without one).
"""
import json, pathlib, statistics, sys

# catalogue id -> Open EV Data id (entries with a measured, non-default curve where available)
PICK = {
    "fiat-500e-2013": "53f0d524",   # AC only in our catalogue; usable capacity only
    "nissan-leaf-24": "dc7d163b",
    "nissan-leaf-40": "77028f96",
    "tesla-model-3-sr": "93c82e06",
    "tesla-model-y-lr": "aade3809",
    "chevrolet-bolt": "36f83e57",
    "kia-niro-ev-64": "68cbedff",
    "vw-id4-77": "cfe2ae21",
}
# usable capacity from another entry where the curve entry lists the gross capacity
CAPACITY_FROM = {"nissan-leaf-24": "294fb510"}  # Leaf 24 kWh 2013: 22 kWh usable
GRID = list(range(0, 101, 10))

src = json.load(open(sys.argv[1]))
cars = src["data"]
here = pathlib.Path(__file__).parent

def interp(curve, x):
    pts = sorted((c["percentage"], c["power"]) for c in curve)
    if x <= pts[0][0]: return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0) if x1 > x0 else y1
    return pts[-1][1]

out = {"source": "Open EV Data (github.com/KilowattApp/open-ev-data), MIT",
       "updated_at": src["meta"]["updated_at"], "vehicles": {}}
for cid, oid in PICK.items():
    v = next(c for c in cars if c["id"].startswith(oid))
    dc = v.get("dc_charger") or {}
    cap = next(c for c in cars if c["id"].startswith(CAPACITY_FROM.get(cid, oid)))
    out["vehicles"][cid] = {
        "oed_id": v["id"], "name": f'{v["brand"]} {v["model"]} {v.get("variant") or ""}'.strip(),
        "release_year": v["release_year"], "usable_kwh": cap["usable_battery_size"], "usable_from": cap["id"],
        "avg_consumption_kwh_100km": v["energy_consumption"]["average_consumption"], "dc_max_kw": dc.get("max_power"), "default_curve": dc.get("is_default_charging_curve"),
        "curve": [[c["percentage"], c["power"]] for c in dc.get("charging_curve") or []],
    }
(here / "data" / "oed_vehicles.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")

# generic curve: median of power/max_power over all cars with a non-default DC curve
rows = []
for c in cars:
    dc = c.get("dc_charger") or {}
    if not dc.get("charging_curve") or dc.get("is_default_charging_curve") or not dc.get("max_power"):
        continue
    rows.append([min(interp(dc["charging_curve"], x) / dc["max_power"], 1.0) for x in GRID])
generic = [round(statistics.median(r[i] for r in rows), 2) for i in range(len(GRID))]
res = {"source": out["source"], "updated_at": out["updated_at"], "n_vehicles": len(rows),
       "soc_pct": GRID, "power_fraction_median": generic}
(here / "results" / "charge_curve.json").write_text(json.dumps(res, indent=1) + "\n")
print(json.dumps(res))
for k, v in out["vehicles"].items(): print(k, v["usable_kwh"], v["dc_max_kw"], v["default_curve"], v["curve"])
