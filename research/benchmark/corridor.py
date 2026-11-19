"""Adaptive corridor (30 -> 60 -> 100 km, as in the app; main experiment) vs fixed 30 km (control).

Same trips, same station states, same policy for every planner. Inputs: trips_seed*.csv (adaptive) and
trips_fixed_seed*.csv (fixed), produced by run.ts with and without CORRIDOR=fixed.
Usage: python research/benchmark/corridor.py -> results/corridor.csv, corridor.json
"""
import glob, json, os
import pandas as pd

R = os.path.join(os.path.dirname(__file__), "results")
load = lambda pat: pd.concat([pd.read_csv(f) for f in sorted(glob.glob(os.path.join(R, pat)))])
runs = {"adaptive": load("trips_seed*.csv"), "fixed30": load("trips_fixed_seed*.csv")}
rows = []
for sc in ["informative", "random"]:
    for planner in ["baseline", "physics", "personal", "full"]:
        for mode, d in runs.items():
            x = d[(d.scenario == sc) & (d.planner == planner)]
            f = x[x.planFound == True]
            ok = f[f.completed == True]
            row = dict(scenario=sc, planner=planner, corridor=mode, trips=len(x),
                       success_pct=100 * len(ok) / len(x), no_plan_pct=100 * (1 - len(f) / len(x)),
                       stranded_pct_of_plans=100 * (1 - (f.completed == True).mean()),
                       risky_pct=100 * (f.risky == True).sum() / len(x),
                       stops=f.chargeStops.mean(), time_h=ok.timeH.mean(), plan_ms=x.planMs.mean(), plan_ms_p95=x.planMs.quantile(0.95))
            for w in (30, 60, 100):
                row[f"found_at_{w}km_pct"] = 100 * (f.corridorKm == w).sum() / len(x)
            rows.append(row)
res = pd.DataFrame(rows)
res.to_csv(os.path.join(R, "corridor.csv"), index=False)
# trip time on trips completed by the planner in both modes (same trips)
pair = []
for sc in ["informative", "random"]:
    for planner in ["baseline", "full"]:
        a, b = (runs[m][(runs[m].scenario == sc) & (runs[m].planner == planner)].set_index("trip") for m in ("adaptive", "fixed30"))
        both = a.index[(a.completed == True) & (b.reindex(a.index).completed == True)]
        pair.append(dict(scenario=sc, planner=planner, common=int(len(both)),
                         time_diff_min=float((a.loc[both].timeH - b.loc[both].timeH).mean() * 60),
                         stops_diff=float((a.loc[both].chargeStops - b.loc[both].chargeStops).mean())))
json.dump({"modes": rows, "paired_common_completed": pair}, open(os.path.join(R, "corridor.json"), "w"), indent=1, ensure_ascii=False)
print(res.round(2).to_string(index=False)); print(pd.DataFrame(pair).round(2).to_string(index=False))
