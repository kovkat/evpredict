"""Статистичне порівняння планувальників (експеримент 3).
Бінарні парні результати (розряд у дорозі) – точний критерій Мак-Немара;
числові парні показники (час поїздки, похибка SoC при прибутті) – критерій Вілкоксона;
різниця часток успішних поїздок – 95 % бутстреп-інтервал за поїздками.
Запуск: python research/benchmark/stats.py
"""
import glob, json, os
import numpy as np
import pandas as pd
from scipy.stats import binomtest, wilcoxon

R = os.path.join(os.path.dirname(__file__), "results")
PL = ["naive", "baseline", "physics", "personal", "full"]
rng = np.random.default_rng(0)
out = []
for tag, pattern in [("base", "trips_seed*.csv"), ("bias15", "trips_bias15_seed*.csv")]:
    files = sorted(glob.glob(os.path.join(R, pattern)))
    d = pd.concat([pd.read_csv(f).assign(seed=f.split("seed")[1][:4]) for f in files])
    d["key"] = d.seed + "_" + d.trip.astype(str)
    d["completed"] = d.completed.fillna(False).astype(bool)
    d["success"] = d.planFound.astype(bool) & d.completed
    for sc in ["informative", "random"]:
        x = d[d.scenario == sc]
        piv = lambda col: x.pivot_table(index="key", columns="planner", values=col, aggfunc="first")
        succ, found, timeH, err = piv("success"), piv("planFound"), piv("timeH"), piv("arrivalErrorPp")
        for p in PL:
            if p not in succ: continue
            row = dict(tag=tag, scenario=sc, planner=p, trips=int(len(succ)),
                       success_pct=100 * succ[p].astype(bool).mean())
            f = x[(x.planner == p) & (x.planFound == True)]
            row["stranded_pct_of_plans"] = 100 * (1 - f.completed.mean())
            row["below_reserve_pct"] = 100 * f.belowReserve.astype(bool).mean()
            row["replans_per_trip"] = f.replans.mean()
            row["failed_stations_per_trip"] = f.failedStations.mean()
            if p != "baseline":
                both = found[p].astype(bool) & found["baseline"].astype(bool)
                sb = ~succ.loc[both, "baseline"].astype(bool); sp = ~succ.loc[both, p].astype(bool)
                n01, n10 = int((sb & ~sp).sum()), int((~sb & sp).sum())   # розряд лише в базового / лише в p
                row["mcnemar_only_baseline_failed"], row["mcnemar_only_p_failed"] = n01, n10
                row["mcnemar_p"] = binomtest(n10, n01 + n10, 0.5).pvalue if n01 + n10 else 1.0
                diff = succ[p].astype(float) - succ["baseline"].astype(float)
                boots = [diff.sample(frac=1, replace=True, random_state=int(rng.integers(1e9))).mean() for _ in range(2000)]
                row["success_diff_pp"] = 100 * diff.mean()
                row["success_diff_ci95"] = [100 * float(np.percentile(boots, 2.5)), 100 * float(np.percentile(boots, 97.5))]
                ok = succ[p].astype(bool) & succ["baseline"].astype(bool)
                dt = (timeH.loc[ok, p] - timeH.loc[ok, "baseline"]) * 60
                row["common_trips"] = int(ok.sum()); row["time_diff_min_mean"] = float(dt.mean()); row["time_diff_min_median"] = float(dt.median())
                row["time_wilcoxon_p"] = float(wilcoxon(dt).pvalue) if ok.sum() > 10 else None
                e = (err.loc[ok, p].abs() - err.loc[ok, "baseline"].abs())
                row["abs_arrival_err_diff_pp"] = float(e.mean())
                row["err_wilcoxon_p"] = float(wilcoxon(e).pvalue) if ok.sum() > 10 else None
            out.append(row)
res = pd.DataFrame(out)
res.to_csv(os.path.join(R, "stats.csv"), index=False)
json.dump(out, open(os.path.join(R, "stats.json"), "w"), ensure_ascii=False, indent=1, default=float)
pd.set_option("display.width", 250)
print(res[["tag", "scenario", "planner", "success_pct", "stranded_pct_of_plans", "below_reserve_pct", "replans_per_trip",
           "success_diff_pp", "success_diff_ci95", "mcnemar_p", "time_diff_min_mean", "time_wilcoxon_p", "abs_arrival_err_diff_pp", "err_wilcoxon_p"]].round(4).to_string())
