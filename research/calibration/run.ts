// Калібрування параметрів персоналізації та інтервалу прогнозу на синтетичних історіях поїздок.
// 8 автомобілів довідника × 3 профілі водія × 5 seed × 60 поїздок; прогноз щоразу робиться до поїздки
// лише за попередньою історією (one-step-ahead). Перевірка на реальних поїздках – research/calibration/ved_check.py.
// Запуск: node --experimental-strip-types --no-warnings research/calibration/run.ts → results/synthetic.json
import { writeFileSync } from "node:fs";
import {
  PARAMS, type ParamDef, type TripRecord, type RoadType, DRIVER_PROFILES, VEHICLE_CATALOG, fitRoadFactors, generateTrips,
  num, list, replayHistory, tripEnergyWh, predictionInterval, safetyFromHistory,
} from "../../lib/energy/src/index.ts";

const set = (id: string, value: number | number[]) => { const r = PARAMS as Record<string, ParamDef>; r[id] = { ...r[id], value }; };
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i)); };
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const histories = VEHICLE_CATALOG.flatMap((m) => DRIVER_PROFILES.flatMap((d) => [1, 2, 3, 4, 5].map((seed) =>
  ({ p: m.params, trips: generateTrips(m.params, d, { count: 60, seed: seed * 101 + m.id.length }) }))));
const out: Record<string, unknown> = { histories: histories.length, tripsPerHistory: 60 };

// 1. α: середня one-step-ahead MAPE прогнозу з k
const alphas = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
const alphaRows = alphas.map((a) => ({ alpha: a, mapePct: r3(mean(histories.map((h) => replayHistory(h.p, h.trips, a).mapePersonalPct))) }));
out.alpha = { grid: alphaRows, best: alphaRows.reduce((b, r) => (r.mapePct < b.mapePct ? r : b)).alpha };

// 2. межі відношення «факт / модель»: на синтетиці без грубих помилок не мають впливати на точність
const clips = [[0.8, 1.25], [0.67, 1.5], [0.5, 2], [0.33, 3], [0.01, 100]];
out.ratioClip = clips.map((c) => { set("ratioClip", c);
  const r = { clip: c, mapePct: r3(mean(histories.map((h) => replayHistory(h.p, h.trips).mapePersonalPct))) }; return r; });
set("ratioClip", [0.5, 2]);

// 3. λ: прогноз Σ k_t·E_t з коефіцієнтами, підібраними за попередніми поїздками (від 10-ї поїздки)
const partsKWh = (p: (typeof histories)[0]["p"], r: TripRecord) =>
  (["city", "suburban", "highway"] as RoadType[]).map((t) => tripEnergyWh(p, { ...r.trip, parts: r.trip.parts.filter((x) => x.type === t),
    elevGainM: 0, elevLossM: 0 }) / 1000);
const lambdaErr = (lambda: number) => mean(histories.map((h) => {
  const rep = replayHistory(h.p, h.trips), errs: number[] = [];
  for (let i = 10; i < h.trips.length; i++) {
    const past = h.trips.slice(0, i).filter((_, j) => rep.rows[j].reliable);
    const kf = fitRoadFactors(h.p, past, rep.rows[i].kBefore, lambda);
    const r = h.trips[i], e = partsKWh(h.p, r), relief = tripEnergyWh(h.p, r.trip) / 1000 - e.reduce((s, x) => s + x, 0);
    const pred = kf.city * e[0] + kf.suburban * e[1] + kf.highway * e[2] + rep.rows[i].kBefore * relief;
    if (rep.rows[i].reliable) errs.push((100 * Math.abs(r.actualKWh - pred)) / r.actualKWh);
  }
  return mean(errs);
}));
const lambdas = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 1e6];
const lambdaRows = lambdas.map((l) => ({ lambda: l, mapePct: r3(lambdaErr(l)) }));
out.ridgeLambda = { grid: lambdaRows, best: lambdaRows.reduce((b, r) => (r.mapePct < b.mapePct ? r : b)).lambda };

// 4. інтервал і запас без історії: квантилі відношення «факт / модель» у популяції (k = 1, перші 5 поїздок)
const firstRatios = histories.flatMap((h) => replayHistory(h.p, h.trips.slice(0, 5)).rows.filter((x) => x.reliable).map((x) => x.actualKWh / x.modelKWh));
out.population = { n: firstRatios.length, q10: r3(quantile(firstRatios, 0.1)), q90: r3(quantile(firstRatios, 0.9)) };

// 5. покриття 80-відсоткового інтервалу і запасу σ залежно від довжини історії
const coverage = (minTrips: number, width: number[]) => {
  set("intervalMinTrips", minTrips); set("intervalMinWidth", width);
  const hit: number[] = [], widthPct: number[] = [];
  for (const h of histories) {
    const rep = replayHistory(h.p, h.trips);
    for (let i = 1; i < h.trips.length; i++) {
      if (!rep.rows[i].reliable) continue;
      const ratios = rep.rows.slice(0, i).filter((x) => x.reliable).map((x) => x.actualKWh / x.modelKWh);
      if (ratios.length < minTrips) continue;
      const k = rep.rows[i].kBefore, [lo, hi] = predictionInterval(k, ratios), rel = rep.rows[i].actualKWh / rep.rows[i].predictedKWh;
      hit.push(rel >= lo && rel <= hi ? 1 : 0); widthPct.push(100 * (hi - lo));
    }
  }
  return { coveragePct: r3(100 * mean(hit)), widthPct: r3(mean(widthPct)), n: hit.length };
};
out.intervalMinTrips = [3, 5, 8, 10, 15].map((j) => ({ minTrips: j, ...coverage(j, list("intervalMinWidth")) }));
out.intervalMinWidth = [[1, 1], [0.99, 1.01], [0.97, 1.03], [0.95, 1.05]].map((w) => ({ width: w, ...coverage(5, w) }));
set("intervalMinTrips", 5); set("intervalMinWidth", [0.97, 1.03]);

// частка поїздок, у яких фактична енергія не перевищила прогноз × σ (σ з попередньої історії)
const safety = (minTrips: number, clip = [1.03, 1.5]) => {
  set("safetyMinTrips", minTrips); set("safetyClip", clip);
  const ok: number[] = [], sig: number[] = [];
  for (const h of histories) {
    const rep = replayHistory(h.p, h.trips);
    for (let i = 1; i < h.trips.length; i++) {
      if (!rep.rows[i].reliable) continue;
      const ratios = rep.rows.slice(0, i).filter((x) => x.reliable).map((x) => x.actualKWh / x.modelKWh);
      if (ratios.length < minTrips) continue;
      const s = safetyFromHistory(rep.rows[i].kBefore, ratios);
      ok.push(rep.rows[i].actualKWh <= rep.rows[i].predictedKWh * s ? 1 : 0); sig.push(s);
    }
  }
  return { minTrips, clip, coveredPct: r3(100 * mean(ok)), meanSigma: r3(mean(sig)),
    atCapPct: r3(100 * mean(sig.map((x) => (x >= clip[1] ? 1 : 0)))), n: ok.length };
};
out.safetyMinTrips = [5, 10, 15, 20].map((j) => safety(j));
out.safetyClip = [[1, 1.5], [1.03, 1.5], [1.05, 1.5], [1.03, 1.3], [1.03, 2]].map((c) => safety(10, c));
set("safetyMinTrips", 10); set("safetyClip", [1.03, 1.5]);
writeFileSync(new URL("results/synthetic.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
