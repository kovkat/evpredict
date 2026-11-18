"""Експеримент 1: точність прогнозу енергоспоживання на реальних поїздках VED.

Порівнюються моделі:
  B0  постійне питоме споживання (Вт·год/км) — так рахує базова модель маршрутизації на Дейкстрі;
  B1  фізична модель EVPredict з номінальними параметрами класу автомобіля;
  M1  фізична модель + персональний коефіцієнт k (оновлюється після кожної поїздки);
  M2  градієнтний бустинг (XGBoost) безпосередньо на ознаках поїздки;
  M3  гібрид: фізична модель + XGBoost на залишках;
  M4  гібрид + персональний коефіцієнт k.
Перевірка «новий користувач»: GroupKFold за автомобілями — модель не бачила жодної поїздки тестового авто.
Запуск: python research/ved/experiment.py
"""
import json, os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.model_selection import GroupKFold
from xgboost import XGBRegressor

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "results")
os.makedirs(OUT, exist_ok=True)

trips = pd.read_csv(os.path.join(HERE, "data", "ved_ev_trips.csv"))
# лише поїздки на електротязі, з ненульовою відстанню та енергією
t = trips[(~trips.engine_on) & (trips.dist_km > 1) & (trips.energy_kwh > 0.05) & trips.oat.notna()].copy()
t = t.sort_values(["veh", "day"]).reset_index(drop=True)

# ---------- фізична модель (та сама, що lib/energy/src/physics.ts) ----------
G, T_COMFORT = 9.81, 21.0
P = dict(cd=0.30, area=2.3, crr=0.0095, eff=0.88, regen=0.6, aux_w=300.0, hvac_w_per_deg=60.0)

def physics_kwh(row) -> float:
    mass = row.Generalized_Weight * 0.4536 + 80            # фунти → кг, + водій
    v = max(row.v_mean_moving, 5) / 3.6
    L = row.dist_km * 1000
    rho = 101325 / (287.05 * (row.oat + 273.15))
    f = P["crr"] * mass * G + 0.5 * rho * P["cd"] * P["area"] * v * v
    e = f * L / P["eff"]
    stops = row.stops_per_km * row.dist_km
    kin = 0.5 * mass * v * v
    e += stops * (kin / P["eff"] - kin * P["regen"])
    aux = P["aux_w"] + P["hvac_w_per_deg"] * abs(row.oat - T_COMFORT)
    e += aux * row.duration_min * 60                            # допоміжні системи працюють і під час простою
    return e / 3.6e6

t["phys"] = t.apply(physics_kwh, axis=1)
FEATURES = ["dist_km", "v_mean_moving", "v_std", "v_max", "idle_share", "stops_per_km", "acc_pos_mean",
            "share_highway", "oat", "duration_min", "Generalized_Weight"]

def personalize(pred: np.ndarray, actual: np.ndarray, alpha=0.2):
    """Прогноз з k, відомим до поїздки; після поїздки k оновлюється (clip 0.5–2.0)."""
    k, out, ks = 1.0, np.empty_like(pred), np.empty_like(pred)
    for i, (p, a) in enumerate(zip(pred, actual)):
        out[i], ks[i] = p * k, k
        k = (1 - alpha) * k + alpha * float(np.clip(a / p, 0.5, 2.0))
    return out, ks

preds = {m: np.zeros(len(t)) for m in ["B0", "B1", "M1", "M2", "M3", "M4"]}
kseq = np.zeros(len(t))
gkf = GroupKFold(n_splits=5)
for tr, te in gkf.split(t, groups=t.veh):
    a, b = t.iloc[tr], t.iloc[te]
    whkm = a.energy_kwh.sum() / a.dist_km.sum()
    preds["B0"][te] = b.dist_km * whkm
    preds["B1"][te] = b.phys
    gb = dict(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8, random_state=0)
    m2 = XGBRegressor(**gb).fit(a[FEATURES], a.energy_kwh)
    preds["M2"][te] = np.maximum(m2.predict(b[FEATURES]), 0.01)
    m3 = XGBRegressor(**gb).fit(a[FEATURES + ["phys"]], a.energy_kwh - a.phys)
    preds["M3"][te] = np.maximum(b.phys + m3.predict(b[FEATURES + ["phys"]]), 0.01)
    # персоналізація: по кожному тестовому автомобілю в хронологічному порядку
    for veh, idx in b.groupby("veh").groups.items():
        pos = np.array([t.index.get_loc(i) for i in idx])
        act = t.energy_kwh.to_numpy()[pos]
        preds["M1"][pos], _ = personalize(preds["B1"][pos], act)
        preds["M4"][pos], kseq[pos] = personalize(preds["M3"][pos], act)

y = t.energy_kwh.to_numpy()
mask = y >= 0.3  # MAPE на дуже коротких поїздках нестабільна
def metrics(p, sel=slice(None)):
    e = p[sel] - y[sel]
    return dict(MAE=np.mean(np.abs(e)), RMSE=np.sqrt(np.mean(e ** 2)),
                MAPE=np.mean(np.abs(e[mask[sel]]) / y[sel][mask[sel]]) * 100)

NAMES = {"B0": "Постійне споживання (база Дейкстри)", "B1": "Фізична модель", "M1": "Фізична + персоналізація k",
         "M2": "XGBoost на ознаках", "M3": "Гібрид: фізична + XGBoost", "M4": "Гібрид + персоналізація k"}
rank = t.groupby("veh").cumcount().to_numpy()
rows = []
for m, p in preds.items():
    long = t.dist_km.to_numpy() >= 10
    r = {"model": m, "name": NAMES[m], **metrics(p), **{f"{k}_after10": v for k, v in metrics(p, rank >= 10).items()},
         **{f"{k}_long": v for k, v in metrics(p, long).items()}}
    rows.append(r)
res = pd.DataFrame(rows)
res.to_csv(os.path.join(OUT, "metrics.csv"), index=False)
summary = dict(trips=int(len(t)), vehicles=int(t.veh.nunique()), ev_trips=int((t.EngineType == "EV").sum()),
               whkm_median=float((t.energy_kwh / t.dist_km * 1000).median()),
               dist_km_median=float(t.dist_km.median()), oat_min=float(t.oat.min()), oat_max=float(t.oat.max()),
               trips_after10=int((rank >= 10).sum()), trips_long=int((t.dist_km >= 10).sum()))
json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), ensure_ascii=False, indent=2)
print(json.dumps(summary, ensure_ascii=False))
print(res.round(3).to_string(index=False))

# ---------- рисунки ----------
plt.rcParams.update({"font.family": "Liberation Sans", "font.size": 11})
fig, ax = plt.subplots(figsize=(8.5, 4.2))
order = ["B0", "B1", "M2", "M3", "M1", "M4"]
vals = [res.set_index("model").loc[m, "MAPE_after10"] for m in order]
cols = ["#9aa5b1", "#9aa5b1", "#6c8ebf", "#2a9d8f", "#6c8ebf", "#2a9d8f"]
bars = ax.barh([NAMES[m] for m in order][::-1], vals[::-1], color=cols[::-1])
for b_, v in zip(bars, vals[::-1]):
    ax.text(v + 0.3, b_.get_y() + b_.get_height() / 2, f"{v:.1f} %", va="center", fontsize=10)
ax.set_xlabel("MAPE на поїздках після 10-ї для кожного автомобіля, %"); ax.grid(axis="x", alpha=.3)
plt.tight_layout(); plt.savefig(os.path.join(OUT, "mape_models.png"), dpi=200); plt.close()

# похибка залежно від номера поїздки користувача
bins = [0, 5, 10, 20, 40, 80, 400]
lab = ["1–5", "6–10", "11–20", "21–40", "41–80", ">80"]
cat = pd.cut(rank + 1, bins=bins, labels=lab)
fig, ax = plt.subplots(figsize=(8, 4))
for m, c in [("B0", "#9aa5b1"), ("M3", "#6c8ebf"), ("M4", "#2a9d8f")]:
    ape = np.where(mask, np.abs(preds[m] - y) / y * 100, np.nan)
    s = pd.Series(ape).groupby(cat, observed=False).mean()
    ax.plot(lab, s.values, marker="o", color=c, label=NAMES[m])
ax.set_xlabel("Номер поїздки користувача"); ax.set_ylabel("MAPE, %"); ax.grid(alpha=.3); ax.legend()
plt.tight_layout(); plt.savefig(os.path.join(OUT, "learning_curve.png"), dpi=200); plt.close()

# важливість ознак гібридної моделі (SHAP) на всій вибірці
try:
    import shap
    m3 = XGBRegressor(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8, random_state=0)
    X = t[FEATURES + ["phys"]]
    m3.fit(X, t.energy_kwh - t.phys)
    sv = shap.TreeExplainer(m3).shap_values(X)
    imp = pd.Series(np.abs(sv).mean(axis=0), index=X.columns).sort_values()
    imp.to_csv(os.path.join(OUT, "shap_importance.csv"))
    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    ax.barh(imp.index, imp.values, color="#2a9d8f"); ax.set_xlabel("Середнє |SHAP| корекції, кВт·год"); ax.grid(axis="x", alpha=.3)
    plt.tight_layout(); plt.savefig(os.path.join(OUT, "shap_importance.png"), dpi=200); plt.close()
except Exception as e:  # SHAP опційний
    print("SHAP skipped:", e)

# ---------- статистична перевірка відмінностей (парні похибки на тих самих поїздках) ----------
from scipy.stats import wilcoxon
rng = np.random.default_rng(0)
vehs = t.veh.to_numpy(); uv = np.unique(vehs)
tests = {}
for a_, b_ in [("M1", "B0"), ("M1", "B1"), ("M4", "M1")]:
    d = np.abs(preds[a_] - y) - np.abs(preds[b_] - y)            # < 0 – перша модель точніша
    # кластерний бутстреп за автомобілями: поїздки одного автомобіля залежні
    boots = []
    for _ in range(2000):
        pick = rng.choice(uv, size=len(uv), replace=True)
        boots.append(np.concatenate([d[vehs == v] for v in pick]).mean())
    tests[f"{a_}_vs_{b_}"] = dict(mae_diff_kwh=float(d.mean()), ci95=[float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
                                  wilcoxon_p=float(wilcoxon(d).pvalue), share_better=float((d < 0).mean()))
json.dump(tests, open(os.path.join(OUT, "tests.json"), "w"), indent=2)
print(json.dumps(tests, indent=1))
