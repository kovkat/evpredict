"""Check of the calibrated personalization and interval parameters on real trips (VED).

Data roles: values are calibrated on synthetic histories (results/synthetic.json). VED vehicles are split
by a fixed rule (sorted vehicle ids: even positions -> validation, odd -> test). Validation vehicles are
used only to pick alpha among the values that are near-optimal on synthetic data (within 0.1 pp of the
best MAPE); every number reported as a check comes from the test vehicles, which take no part in any choice.
Physics model and data: research/ved/experiment.py (imported up to the model fitting).
Usage: python research/calibration/ved_check.py -> research/calibration/results/ved_check.json
"""
import json, math, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "..", "ved", "experiment.py")).read()
ns = {"__file__": os.path.join(HERE, "..", "ved", "experiment.py")}
exec(src[:src.index("FEATURES = ")], ns)
t = ns["t"]
groups = [(v, (g.phys.to_numpy(), g.energy_kwh.to_numpy())) for v, g in sorted(t.groupby("veh"), key=lambda x: x[0]) if len(g) >= 10]
VALID = [sq for i, (_, sq) in enumerate(groups) if i % 2 == 0]
TEST = [sq for i, (_, sq) in enumerate(groups) if i % 2 == 1]
seqs = TEST

syn = json.load(open(os.path.join(HERE, "results", "synthetic.json")))

def replay(pred, act, alpha, clip=(0.5, 2.0)):
    k, ks = 1.0, []
    for p, a in zip(pred, act):
        ks.append(k)
        k = (1 - alpha) * k + alpha * float(np.clip(a / p, *clip))
    return np.array(ks)

def mape(alpha, clip=(0.5, 2.0), data=None):
    e = [np.abs(a - p * replay(p, a, alpha, clip)) / a for p, a in (data or seqs)]
    return float(np.mean(np.concatenate(e)) * 100)

def cu(xs, q):  # conformal upper order statistic
    s = np.sort(xs); return s[min(len(s) - 1, math.ceil((len(s) + 1) * q) - 1)]
def cl(xs, q):
    s = np.sort(xs); return s[max(0, math.floor((len(s) + 1) * q) - 1)]

out = {"split": "sorted vehicle ids: even -> validation, odd -> test",
       "validation": {"vehicles": len(VALID), "trips": int(sum(len(p) for p, _ in VALID))},
       "test": {"vehicles": len(TEST), "trips": int(sum(len(p) for p, _ in TEST))}}
best = min(r["mapePct"] for r in syn["alpha"]["grid"])
near = [r["alpha"] for r in syn["alpha"]["grid"] if r["mapePct"] - best <= 0.1]
val = {a: mape(a, data=VALID) for a in near}
alpha = min(val, key=val.get)
out["alpha"] = {"near_optimal_on_synthetic": near, "validation_mapePct": {str(a): round(v, 3) for a, v in val.items()},
                "chosen": alpha, "test_mapePct": {str(a): round(mape(a), 3) for a in near}}
out["ratioClip"] = [{"clip": list(c), "mapePct": round(mape(alpha, c), 3)} for c in [(0.8, 1.25), (0.67, 1.5), (0.5, 2.0), (0.33, 3.0), (0.01, 100.0)]]
ratios = np.concatenate([a / p for p, a in seqs])
out["ratio"] = {"q005": round(float(np.quantile(ratios, 0.005)), 3), "q10": round(float(np.quantile(ratios, 0.1)), 3),
                "q90": round(float(np.quantile(ratios, 0.9)), 3), "q995": round(float(np.quantile(ratios, 0.995)), 3),
                "inside_0.5_2_pct": round(float(np.mean((ratios >= 0.5) & (ratios <= 2)) * 100), 2)}
lo, hi = syn["population"]["q10"], syn["population"]["q90"]
out["default_interval"] = {"interval": [lo, hi], "coveragePct": round(float(np.mean((ratios >= lo) & (ratios <= hi)) * 100), 1),
                           "sigma0_coveredPct": round(float(np.mean(ratios <= hi) * 100), 1)}
# one-step-ahead conformal interval and safety factor from the vehicle's own history (alpha from the registry run)
hit = up = cap = n = 0
for p, a in seqs:
    ks = replay(p, a, alpha)
    for i in range(5, len(p)):
        rel = (a[:i] / p[:i]) / ks[i]
        r = a[i] / (p[i] * ks[i])
        sig = max(1.03, min(1.5, cu(rel, 0.9)))
        hit += cl(rel, 0.1) <= r <= cu(rel, 0.9); up += r <= sig; cap += sig >= 1.5; n += 1
out["history_interval"] = {"alpha": alpha, "n": n, "coveragePct": round(hit / n * 100, 1), "sigma_coveredPct": round(up / n * 100, 1),
                          "sigma_at_cap_pct": round(cap / n * 100, 1)}
json.dump(out, open(os.path.join(HERE, "results", "ved_check.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
