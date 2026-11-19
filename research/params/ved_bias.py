"""Check of the WLTC acceleration correction on real trips (VED): no parameter is fitted here.

Median ratio actual / physics-model energy, overall and by trip speed, highway share and length,
with and without the in-traffic acceleration term (research/ved/experiment.py, FLUCT).
A ratio near 1 in every group means the correction is not over- or under-applied for some trip type.
Usage: python research/params/ved_bias.py -> research/params/results/ved_bias.json
"""
import json, os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(HERE, "..", "ved", "experiment.py")
src = open(path).read()
ns = {"__file__": path}
exec(src[:src.index("FEATURES = ")], ns)
t = ns["t"]
with_fluct = t.energy_kwh / t.phys
ns["FLUCT"] = 0.0
without = t.energy_kwh / t.apply(ns["physics_kwh"], axis=1)

groups = {"speed_kmh": pd.cut(t.v_mean_moving, [0, 35, 45, 55, 100]),
          "highway_share": pd.cut(t.share_highway, [-0.01, 0, 0.3, 1]),
          "dist_km": pd.cut(t.dist_km, [0, 3, 10, 100])}
out = {"trips": len(t), "median_ratio": {"without_correction": round(float(without.median()), 3),
                                          "with_correction": round(float(with_fluct.median()), 3)}, "by_group": {}}
for name, g in groups.items():
    out["by_group"][name] = [{"bin": str(b), "n": int((g == b).sum()), "without": round(float(without[g == b].median()), 3),
                              "with": round(float(with_fluct[g == b].median()), 3)} for b in g.cat.categories]
json.dump(out, open(os.path.join(HERE, "results", "ved_bias.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
