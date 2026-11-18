"""Аналіз чутливості до штрафу за ненадійність станції T_f (повна версія EVPredict).
Дані: trips_seed*.csv (T_f = 0,75 год) і trips_tf{0,150,300}_seed*.csv,
отримані командою TF=<год> node --experimental-strip-types research/benchmark/run.ts 400 <seed> 0.
"""
import glob, json, os
import pandas as pd

R = os.path.join(os.path.dirname(__file__), "results")
rows = []
for tf, pat in [(0.0, "trips_tf0_seed*.csv"), (0.75, "trips_seed*.csv"), (1.5, "trips_tf150_seed*.csv"), (3.0, "trips_tf300_seed*.csv")]:
    d = pd.concat([pd.read_csv(f) for f in sorted(glob.glob(os.path.join(R, pat)))])
    for sc in ["informative", "random"]:
        x = d[(d.planner == "full") & (d.scenario == sc)]
        f = x[x.planFound == True]
        ok = f[f.completed == True]
        rows.append(dict(Tf_h=tf, scenario=sc, trips=len(x), success_pct=100 * len(ok) / len(x),
                         stranded_pct_of_plans=100 * (1 - (f.completed == True).mean()),
                         failed_stations_per_trip=f.failedStations.mean(), stops=f.chargeStops.mean(),
                         time_h=ok.timeH.mean()))
res = pd.DataFrame(rows)
res.to_csv(os.path.join(R, "sensitivity_tf.csv"), index=False)
print(res.round(3).to_string(index=False))
