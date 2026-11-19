"""WLTC class 3b statistics (UN GTR No. 15) for trip-part speeds, acceleration density and braking.

The model (lib/energy/src/physics.ts) uses a mean speed per road part and counts the kinetic energy of
accelerations as n * m v^2 / 2 per km. Real driving accelerates not only after full stops, so n is
taken as the number of equivalent accelerations from standstill that gives the same positive kinetic
energy (PKE) as the cycle: n = PKE * 1000 / v^2, PKE = sum(max(v[i]^2 - v[i-1]^2, 0)) / distance.

Cycle data: JRC `wltp` package (wltp.cycles.class3.class_data_b), EUPL.
Usage: python research/params/wltc.py -> research/params/results/wltc.json,
       research/params/data/wltc_class3b_kmh.json (speed trace, 1 Hz)
"""
import json, math, pathlib
from wltp.cycles.class3 import class_data_b

FIORI_LAMBDA = 0.0411  # Fiori, Ahn, Rakha 2016: regen fraction exp(-lambda/|a|), a in m/s^2
# model speeds (km/h) the equivalent acceleration density is computed for
MODEL_SPEED = {"city": 34, "high": 61, "extra_high": 110, "city_edge": 50, "highway_edge": 90}

here = pathlib.Path(__file__).parent
d = class_data_b()
kmh = d["cycle"]
v = [x / 3.6 for x in kmh]
parts = dict(zip(["low", "medium", "high", "extra_high"], d["parts"]))
# WLTP city cycle = Low + Medium phases (Regulation (EU) 2017/1151, Annex XXI, Sub-Annex 8)
parts["city"] = [parts["low"][0], parts["medium"][1]]
out = {"source": "UN GTR No. 15, WLTC class 3b; JRC wltp package", "phases": {}, "equivalent_accelerations_per_km": {}}
for name, (a, b) in parts.items():
    seg = v[a:b + 1]
    dist = sum(seg)  # m (1 s steps)
    moving = [x for x in seg if x > 0]
    stops = sum(1 for i in range(1, len(seg)) if seg[i] == 0 and seg[i - 1] > 0)
    pke = sum(max(seg[i] ** 2 - seg[i - 1] ** 2, 0) for i in range(1, len(seg))) / dist
    out["phases"][name] = {
        "parts": [a, b], "distance_km": round(dist / 1000, 3), "duration_s": len(seg),
        "mean_speed_kmh": round(dist / len(seg) * 3.6, 1),
        "moving_speed_kmh": round(sum(moving) / len(moving) * 3.6, 1),
        "full_stops_per_km": round(stops / (dist / 1000), 2),
        "pke_m_s2": round(pke, 4),
    }
for key, phase in [("city", "city"), ("high", "high"), ("extra_high", "extra_high"), ("city_edge", "city"), ("highway_edge", "extra_high")]:
    vm = MODEL_SPEED[key] / 3.6
    out["equivalent_accelerations_per_km"][key] = {
        "phase": phase, "speed_kmh": MODEL_SPEED[key], "n": round(out["phases"][phase]["pke_m_s2"] * 1000 / vm ** 2, 2)}
# braking-energy-weighted regen fraction over the whole cycle
w_sum = eta_sum = 0.0
for i in range(1, len(v)):
    acc = v[i] - v[i - 1]
    if acc < 0:
        e = -acc * (v[i] + v[i - 1]) / 2  # kinetic energy released per kg
        w_sum += e
        eta_sum += e * math.exp(-FIORI_LAMBDA / abs(acc))
out["braking"] = {"regen_fraction_weighted": round(eta_sum / w_sum, 3),
                  "note": "exp(-0.0411/|a|) weighted by released kinetic energy, Fiori et al. 2016"}
(here / "results" / "wltc.json").write_text(json.dumps(out, indent=1) + "\n")
(here / "data" / "wltc_class3b_kmh.json").write_text(json.dumps({"source": out["source"], "kmh": kmh}) + "\n")
print(json.dumps({k: out[k] for k in ("equivalent_accelerations_per_km", "braking")}, indent=1))
print({k: (p["moving_speed_kmh"], p["full_stops_per_km"], p["pke_m_s2"]) for k, p in out["phases"].items()})
