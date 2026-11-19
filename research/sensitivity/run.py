"""One-at-a-time sensitivity of the route recommendation to parameters without a direct source.

Each parameter is set to a low and a high value (default x0.5 and x1.5, clipped to its valid range;
special ranges below), the benchmark (research/benchmark/run.ts, 400 trips, seeds 2026-2028) is rerun
with PARAM_OVERRIDES, and metrics of the full EVPredict planner are compared with the default run.
The simulated world (station failures, energy) does not depend on the overrides, see run.ts.

Usage (from the repo root): python research/sensitivity/run.py [jobs]
Output: research/sensitivity/results/oat.csv, oat.json, oat.md; raw runs in research/sensitivity/runs (gitignored).
With STATIONS=diverse the station-dependent parameters are rerun on a stress registry where every branch of the
reliability index is used (research/sensitivity/diverse.ts); output files get the suffix _diverse.
Besides metric changes, each row reports the share of trips whose plan or outcome changed at all ("activity"):
a parameter with zero activity is not shown to be unimportant, only unused in that world.
"""
import json, os, pathlib, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).parent
DIVERSE = os.environ.get("STATIONS") == "diverse"
SUFFIX = "_diverse" if DIVERSE else ""
RUNS, RES = HERE / f"runs{SUFFIX}", HERE / "results"
SEEDS = [2026, 2027, 2028]
JOBS = int(sys.argv[1]) if len(sys.argv) > 1 else 2

# default values come from the registry (printed by a one-line node call)
reg = json.loads(subprocess.check_output(
    ["node", "--experimental-strip-types", "--no-warnings", "-e",
     'import("./lib/energy/src/params.ts").then(m=>console.log(JSON.stringify(Object.fromEntries('
     'Object.entries(m.PARAMS).filter(([,p])=>p.origin==="provisional"&&p.plan==="sensitivity").map(([k,p])=>[k,p.value])))))'],
    cwd=ROOT, text=True))

if DIVERSE:  # only parameters that act through the station registry
    reg = {k: v for k, v in reg.items() if k.startswith("rel") or k in ("minNodeReliability", "minReliability", "failurePenaltyH", "corridorStepsKm")}
PROB = {k for k in reg if k.startswith("relBase") or k in ("minReliability", "minNodeReliability", "relCheckinOkMax")}
SPECIAL = {
    "relClip": ([0.01, 0.9], [0.05, 0.99]),
    "relSiteMax": (0.95, 0.99),
    "chargeTargets": ([0.6, 0.8], [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]),
    "maxReplans": (1, 5),
    "relPointsMax": (2, 6),
}

def scale(v, f, k):
    if isinstance(v, list): return [round(x * f, 4) for x in v]
    x = round(v * f, 6)
    return min(max(x, 0.01), 0.99) if k in PROB else x

def levels(k, v):
    return SPECIAL.get(k, (scale(v, 0.5, k), scale(v, 1.5, k)))

def run(tag, overrides, seed):
    out = RUNS / tag
    f = out / f"summary_seed{seed}.json"
    if not f.exists():
        out.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "OUT": str(out), "PARAM_OVERRIDES": json.dumps(overrides)}  # STATIONS passes through
        subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "research/benchmark/run.ts", "400", str(seed)],
                       cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
    return json.loads(f.read_text())

tasks = [("default", {}, s) for s in SEEDS]
for k, v in reg.items():
    lo, hi = levels(k, v)
    tasks += [(f"{k}_lo", {k: lo}, s) for s in SEEDS] + [(f"{k}_hi", {k: hi}, s) for s in SEEDS]
with ThreadPoolExecutor(JOBS) as ex:
    results = list(ex.map(lambda t: (t[0], run(*t)), tasks))

METRICS = ["successPct", "strandedPct", "belowReservePct", "meanTimeH_common", "meanStops"]
def per_seed(tag, scenario):
    return {seed: next(r for r in summ if r["planner"] == "full" and r["scenario"] == scenario)
            for (t, summ), (_, _, seed) in zip(results, tasks) if t == tag}

import csv
def trips(tag, seed):
    with open(RUNS / tag / f"trips_seed{seed}.csv") as f:
        return {(r["trip"], r["scenario"]): (r["planFound"], r["plannedStops"], r["plannedTimeH"][:8], r["completed"], r["timeH"][:8])
                for r in csv.DictReader(f) if r["planner"] == "full"}
def activity(tag):
    changed = total = 0
    for s in SEEDS:
        a, b = trips("default", s), trips(tag, s)
        changed += sum(a[k] != b[k] for k in a); total += len(a)
    return 100 * changed / total

table = []
for scenario in ["informative", "random"]:
    base = per_seed("default", scenario)
    for k, v in reg.items():
        lo, hi = levels(k, v)
        for lvl, val in (("lo", lo), ("hi", hi)):
            run_ = per_seed(f"{k}_{lvl}", scenario)
            row = {"scenario": scenario, "param": k, "level": lvl, "value": json.dumps(val), "default": json.dumps(v),
                   "activityPct": round(activity(f"{k}_{lvl}"), 2)}
            for m in METRICS:
                d = [run_[s][m] - base[s][m] for s in SEEDS]
                if m == "meanTimeH_common":  # relative change of trip time, %
                    d = [100 * (run_[s][m] / base[s][m] - 1) for s in SEEDS]
                row[f"d_{m}"] = round(sum(d) / len(d), 3)
                row[f"d_{m}_min"], row[f"d_{m}_max"] = round(min(d), 3), round(max(d), 3)
            table.append(row)
RES.mkdir(exist_ok=True)
cols = list(table[0].keys())
q = lambda c, x: f'"{x}"' if c in ("value", "default") else str(x)
(RES / f"oat{SUFFIX}.csv").write_text("\n".join([",".join(cols)] + [",".join(q(c, r[c]) for c in cols) for r in table]) + "\n")
mean_base = {sc: {m: sum(r[m] for r in per_seed("default", sc).values()) / len(SEEDS) for m in METRICS} for sc in ["informative", "random"]}
(RES / f"oat{SUFFIX}.json").write_text(json.dumps({"seeds": SEEDS, "trips_per_seed": 400, "planner": "full", "default": mean_base, "rows": table}, indent=1, ensure_ascii=False) + "\n")

# підсумок: найбільша зміна за двома рівнями і двома сценаріями; поріг практичної значущості –
# 1 п. п. успішних поїздок або поїздок з розрядом, 2 % часу поїздки
lines = ["| Параметр | Значення | Межі перевірки | Змінено поїздок, % | Δ успішних, п. п. | Δ розряд, п. п. | Δ час, % | Висновок |", "|---|---|---|---|---|---|---|---|"]
for k, v in reg.items():
    rs = [r for r in table if r["param"] == k]
    big = lambda m: max(rs, key=lambda r: abs(r[f"d_{m}"]))[f"d_{m}"]
    ds, dst, dt = big("successPct"), big("strandedPct"), big("meanTimeH_common")
    lo, hi = levels(k, v)
    act = max(r["activityPct"] for r in rs)
    verdict = "не задіяний" if act == 0 else "стійко" if abs(ds) < 1 and abs(dst) < 1 and abs(dt) < 2 else "впливає"
    lines.append(f"| {k} | {json.dumps(v)} | {json.dumps(lo)} / {json.dumps(hi)} | {act:.1f} | {ds:+.2f} | {dst:+.2f} | {dt:+.2f} | {verdict} |")
(RES / f"oat{SUFFIX}.md").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
