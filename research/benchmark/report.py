"""Зведення експерименту 2 за кількома запусками і рисунки для звіту."""
import glob, json, os
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(__file__)
R = os.path.join(HERE, "results")
d = pd.concat([pd.read_csv(f).assign(seed=f.split("seed")[1][:4]) for f in glob.glob(os.path.join(R, "trips_seed*.csv"))])
# Єдині визначення метрик (ті самі, що в stats.py):
#   успішна поїздка – план знайдено і виконано без розряду, % від усіх поїздок;
#   розряд у дорозі – % від поїздок, для яких план знайдено.
d["planFound"] = d.planFound == True
d["stranded"] = d.planFound & (d.completed == False)
d["success"] = d.planFound & (d.completed == True)
NAMES = {"naive": "Наївний (пряма поїздка без обмежень)", "baseline": "Базовий (Дейкстра, постійне споживання)", "physics": "EVPredict: фізична модель",
         "personal": "EVPredict: + персоналізація і запас", "full": "EVPredict: + надійність станцій і адаптивність"}
rows = []
for (sc, pl), g in d.groupby(["scenario", "planner"]):
    per = g.groupby("seed").apply(lambda s: pd.Series(dict(success=s.success.mean(),
                                  stranded=s.stranded.sum() / max(1, s.planFound.sum()))), include_groups=False)
    found = g[g.planFound == True]
    ok = g[g.success]
    rows.append(dict(scenario=sc, planner=pl, name=NAMES[pl], trips=len(g),
        success_pct=per.success.mean() * 100, success_sd=per.success.std() * 100,
        stranded_pct=per.stranded.mean() * 100, stranded_sd=per.stranded.std() * 100,
        below_reserve_pct=(found.belowReserve == True).mean() * 100,
        plan_found_pct=(g.planFound == True).mean() * 100,
        arrival_err_pp=ok.arrivalErrorPp.abs().mean(), stops=found.chargeStops.mean(), replans=found.replans.mean()))
res = pd.DataFrame(rows)
# час у дорозі на поїздках, які успішно завершили обидва: базовий і повний EVPredict
both = d[d.success].pivot_table(index=["seed", "scenario", "trip"], columns="planner", values="timeH")
both = both.dropna(subset=["baseline", "full"])
time_cmp = dict(trips=int(len(both)), baseline_h=float(both.baseline.mean()), full_h=float(both.full.mean()),
                delta_min=float((both.full - both.baseline).mean() * 60))
res.to_csv(os.path.join(R, "summary_all.csv"), index=False)
json.dump(time_cmp, open(os.path.join(R, "time_comparison.json"), "w"), indent=2)
print(res.round(2).to_string(index=False)); print(time_cmp)

plt.rcParams.update({"font.family": "Liberation Sans", "font.size": 11, "axes.formatter.use_locale": False})
from matplotlib.ticker import FuncFormatter
COMMA = FuncFormatter(lambda x, _: f"{x:g}".replace(".", ","))
order = ["naive", "baseline", "physics", "personal", "full"]
cols = ["#d9d9d9", "#9aa5b1", "#6c8ebf", "#4aa3a2", "#2a9d8f"]
sub = res[res.scenario == "informative"].set_index("planner").loc[order]
fig, axes = plt.subplots(1, 3, figsize=(13, 4.2))
for ax, (col, sd, title) in zip(axes, [("success_pct", "success_sd", "Успішні поїздки, %"),
                                      ("stranded_pct", "stranded_sd", "Розряд у дорозі, % планів"),
                                      ("arrival_err_pp", None, "Похибка SoC при прибутті, п. п.")]):
    ax.bar(range(5), sub[col], yerr=sub[sd] if sd else None, color=cols, capsize=4)
    top = float((sub[col] + (sub[sd] if sd else 0)).max())
    for i, v in enumerate(sub[col]):
        e = float(sub[sd].iloc[i]) if sd else 0.0
        ax.text(i, v + e + top * 0.02, f"{v:.1f}".replace(".", ","), ha="center", va="bottom", fontsize=10)
    ax.set_ylim(0, top * 1.15)
    ax.set_xticks(range(5)); ax.set_xticklabels(["Наїв.", "Дейкстра", "Фізика", "+Перс.", "Повна"]); ax.set_title(title, fontsize=11); ax.grid(axis="y", alpha=.3); ax.yaxis.set_major_formatter(COMMA)
plt.tight_layout(); plt.savefig(os.path.join(R, "benchmark.png"), dpi=200); plt.close()

# розряд у дорозі залежно від температури
d["temp_bin"] = pd.cut(d.tempC, [-30, 0, 10, 40], labels=["≤ 0 °C", "0…10 °C", "> 10 °C"])
t = d[(d.planFound == True) & (d.scenario == "informative")].groupby(["temp_bin", "planner"], observed=False).stranded.mean().unstack() * 100
fig, ax = plt.subplots(figsize=(7.5, 4))
w = 0.16
for i, pl in enumerate(order):
    ax.bar([x + (i - 2) * w for x in range(len(t))], t[pl], width=w, color=cols[i], label=NAMES[pl])
ax.set_xticks(range(len(t))); ax.set_xticklabels(t.index); ax.set_ylabel("Розряд у дорозі, % планів"); ax.grid(axis="y", alpha=.3); ax.legend(fontsize=8)
plt.tight_layout(); plt.savefig(os.path.join(R, "stranded_by_temp.png"), dpi=200); plt.close()
