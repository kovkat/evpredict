"""Світ з рельєфом і вітром (WORLD=ua): чи допомагає EVPredict знання прогнозу вітру і висот вузлів.
Порівнюються повна версія (full) і та сама версія з погодою та рельєфом (weather) на однакових поїздках.
Розряд у дорозі – точний критерій Мак-Немара; похибка заряду на прибуття і час – критерій Вілкоксона
на поїздках, завершених обома; різниця часток успішних поїздок і поїздок з SoC нижче резерву – 95 % бутстреп-інтервал.
Запуск: WORLD=ua node --experimental-strip-types research/benchmark/run.ts 400 <seed> для seed 2026–2028,
потім python research/benchmark/weather_stats.py
"""
import glob, json, os
import numpy as np
import pandas as pd
from scipy.stats import binomtest, wilcoxon

R = os.path.join(os.path.dirname(__file__), "results")
rng = np.random.default_rng(0)
files = sorted(glob.glob(os.path.join(R, "trips_ua_seed*.csv")))
d = pd.concat([pd.read_csv(f).assign(seed=f.split("seed")[1][:4]) for f in files])
d["key"] = d.seed + "_" + d.trip.astype(str)
d["completed"] = d.completed.fillna(False).astype(bool)
d["belowReserve"] = d.belowReserve.fillna(False).astype(bool)
d["success"] = d.planFound.astype(bool) & d.completed

def boot(a, b, n=5000):
    """95 % бутстреп-інтервал для різниці середніх парних бінарних показників (b − a), у п. п."""
    diff = (b.astype(float) - a.astype(float)).to_numpy()
    idx = rng.integers(0, len(diff), (n, len(diff)))
    m = diff[idx].mean(axis=1) * 100
    return [float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))]

out = []
for sc in ["informative", "random"]:
    x = d[d.scenario == sc]
    piv = lambda col: x.pivot_table(index="key", columns="planner", values=col, aggfunc="first")
    succ, found, comp, below, err, timeH = piv("success"), piv("planFound"), piv("completed"), piv("belowReserve"), piv("arrivalErrorPp"), piv("timeH")
    row = dict(scenario=sc, trips=int(len(succ)))
    for p in ["baseline", "full", "weather"]:
        f = x[(x.planner == p) & (x.planFound == True)]
        row[p] = dict(success_pct=100 * succ[p].astype(bool).mean(), stranded_pct_of_plans=100 * (1 - f.completed.mean()),
                      below_reserve_pct=100 * f.belowReserve.mean(), mean_abs_arrival_err_pp=float(f[f.completed].arrivalErrorPp.abs().mean()))
    both = found["full"].astype(bool) & found["weather"].astype(bool)
    sf, sw = ~comp.loc[both, "full"].astype(bool), ~comp.loc[both, "weather"].astype(bool)
    n_full_only, n_weather_only = int((sf & ~sw).sum()), int((~sf & sw).sum())
    row["stranded_only_full"], row["stranded_only_weather"] = n_full_only, n_weather_only
    row["mcnemar_p"] = binomtest(n_weather_only, n_full_only + n_weather_only, 0.5).pvalue if n_full_only + n_weather_only else 1.0
    row["success_diff_pp"] = 100 * (succ["weather"].astype(bool).mean() - succ["full"].astype(bool).mean())
    row["success_diff_ci95"] = boot(succ["full"].astype(bool), succ["weather"].astype(bool))
    bb = both & comp["full"].astype(bool) & comp["weather"].astype(bool)
    row["below_reserve_diff_pp"] = 100 * (below.loc[bb, "weather"].astype(bool).mean() - below.loc[bb, "full"].astype(bool).mean())
    row["below_reserve_diff_ci95"] = boot(below.loc[bb, "full"].astype(bool), below.loc[bb, "weather"].astype(bool))
    ef, ew = err.loc[bb, "full"].abs(), err.loc[bb, "weather"].abs()
    row["common_completed"] = int(bb.sum())
    row["abs_err_full_pp"], row["abs_err_weather_pp"] = float(ef.mean()), float(ew.mean())
    row["abs_err_wilcoxon_p"] = float(wilcoxon(ew, ef).pvalue)
    row["time_diff_min_mean"] = float(60 * (timeH.loc[bb, "weather"] - timeH.loc[bb, "full"]).mean())
    row["time_wilcoxon_p"] = float(wilcoxon(timeH.loc[bb, "weather"], timeH.loc[bb, "full"]).pvalue)
    out.append(row)

json.dump(out, open(os.path.join(R, "ua_weather_stats.json"), "w"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
