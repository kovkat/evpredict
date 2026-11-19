"""Auxiliary base power P_0 and climate-control slope h from chassis-dynamometer data.

Data: U.S. DOE Vehicle Technologies Office, Program Record "Impact of Cold Ambient
Temperature and Extreme Conditions on Electric Vehicles" (Sep 2024), Argonne APRF tests
of two BEVs: HVAC power on UDDS at 20 F, 0 F, 72 F (HVAC off) and 95 F; other loads at 72 F.
Model (lib/energy/src/physics.ts): P_aux = P_0 + h * |T - T_c|, T_c = 21 C (comfortTemp).
Usage: python research/params/hvac_fit.py  ->  research/params/results/hvac_fit.json
"""
import json, pathlib

T_C = 21.0
f2c = lambda f: (f - 32) / 1.8
# (ambient F, HVAC W) for BEV1 and BEV2
HVAC = [(20, 1848), (20, 2898), (0, 3376), (0, 3732), (72, 0), (72, 0), (95, 956), (95, 755)]
OTHER_72F = [144, 226]  # W, auxiliary loads with HVAC off

x = [abs(f2c(f) - T_C) for f, _ in HVAC]
y = [w for _, w in HVAC]
h = sum(a * b for a, b in zip(x, y)) / sum(a * a for a in x)  # least squares through origin
p0 = sum(OTHER_72F) / len(OTHER_72F)
resid = [b - h * a for a, b in zip(x, y)]
# separate slopes for BEV1 (even rows) and BEV2 (odd rows)
per_vehicle = []
for k in (0, 1):
    xs, ys = x[k::2], y[k::2]
    per_vehicle.append(round(sum(a * b for a, b in zip(xs, ys)) / sum(a * a for a in xs), 1))
out = {"source": "U.S. DOE VTO Program Record, Sep 2024 (ANL APRF data)", "comfort_c": T_C,
       "h_w_per_c": round(h, 1), "h_per_vehicle": per_vehicle, "p0_w": p0,
       "rmse_w": round((sum(r * r for r in resid) / len(resid)) ** 0.5, 0),
       "points": [{"ambient_c": round(f2c(f), 1), "hvac_w": w} for f, w in HVAC]}
(pathlib.Path(__file__).parent / "results" / "hvac_fit.json").write_text(json.dumps(out, indent=1) + "\n")
print(out)
