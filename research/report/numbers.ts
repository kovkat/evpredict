// Числа для пояснювальної записки, які рахує саме ядро застосунку:
//   1) приклад розкладу прогнозу значеннями Шеплі з перевіркою адитивності (п. 3.3);
//   2) розподіл індексу надійності станцій постійного струму на знімку реєстру (п. 3.4);
//   3) плани для всіх впорядкованих пар міст довідника і трьох автомобілів: знайдені, ризиковані, відсутні;
//   4) швидкодія прогнозу і побудови маршруту.
// Запуск: node --experimental-strip-types --no-warnings research/report/numbers.ts
// Результат: research/results/report_numbers.json і report_numbers.md
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { cpus } from "node:os";
import * as E from "../../lib/energy/src/index.ts";

const root = new URL("../../", import.meta.url).pathname;
const stations: E.StationRecord[] = JSON.parse(readFileSync(`${root}artifacts/api-server/src/data/ua_stations.json`, "utf8"));
const SNAPSHOT = new Date("2026-10-10T00:00:00Z");
const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number, d = 2) => x.toFixed(d).replace(".", ",").replace("-", "−");
const quant = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

// 1) Приклад Шеплі
const leaf = E.findVehicle("nissan-leaf-40")!;
const exampleInput = { vehicle: "nissan-leaf-40", sohPct: 88, k: 1.12, cityKm: 10, highwayKm: 80, highwaySpeedKmh: 110, tempC: -5, elevGainM: 150, elevLossM: 120 };
const trip: E.TripInput = {
  parts: [{ ...E.DEFAULT_PARTS.city, km: exampleInput.cityKm }, { ...E.DEFAULT_PARTS.highway, km: exampleInput.highwayKm, speedKmh: exampleInput.highwaySpeedKmh }],
  tempC: exampleInput.tempC, elevGainM: exampleInput.elevGainM, elevLossM: exampleInput.elevLossM,
};
const f = E.forecastTrip({ vehicle: E.withStateOfHealth(leaf.params, exampleInput.sohPct), trip, personalFactor: exampleInput.k, socStartPct: 90, lang: "uk" });
const sumParts = f.baseKWh + f.contributions.reduce((s, c) => s + c.kWh, 0);
const shapley = {
  input: exampleInput, forecastKWh: r2(f.energyKWh), referenceKWh: r2(f.baseKWh),
  contributions: Object.fromEntries(f.contributions.map((c) => [c.label, r2(c.kWh)])),
  additivityErrorKWh: Math.abs(sumParts - f.energyKWh), explanation: f.explanation,
};

// 2) Індекс надійності
const dc = stations.filter((s) => s.dc);
const scores = dc.map((s) => E.reliabilityScore(s, SNAPSHOT).score);
const rhoMin = E.num("minReliability"), rhoExcl = E.num("minNodeReliability");
const reliability = {
  snapshot: "2026-10-10", stations: stations.length, dcStations: dc.length,
  median: r2(quant(scores, 0.5)), q1: r2(quant(scores, 0.25)), q3: r2(quant(scores, 0.75)),
  min: r2(Math.min(...scores)), max: r2(Math.max(...scores)),
  belowRhoMin: scores.filter((x) => x < rhoMin).length, belowExclusion: scores.filter((x) => x < rhoExcl).length,
  withCheckins: dc.filter((s) => (s.checkinsOk ?? 0) + (s.checkinsFailed ?? 0) > 0).length,
  byStatus: Object.entries(dc.reduce<Record<string, number>>((m, s) => { const k = String(s.statusTypeId ?? "невідомо"); m[k] = (m[k] ?? 0) + 1; return m; }, {})),
};

// 3–4) Маршрути і швидкодія
const cars = ["nissan-leaf-40", "kia-niro-ev-64", "tesla-model-3-sr"].map((id) => E.findVehicle(id)!);
const routeStats: Record<string, unknown>[] = [];
for (const v of cars) {
  const times: number[] = []; let found = 0, risky = 0, none = 0, stops = 0;
  for (const a of E.UA_CITIES) for (const b of E.UA_CITIES) {
    if (a.id === b.id) continue;
    const t0 = performance.now();
    const r = E.planRoute({ from: a, to: b, vehicle: E.withStateOfHealth(v.params, 90), ratedVehicle: v.params, connectors: v.connectors,
      maxDcKw: v.maxDcKw, socStartPct: 90, reservePct: 10, tempC: 0, personalFactor: 1, stations, now: SNAPSHOT });
    times.push(performance.now() - t0);
    if (!r.evpredict.found) none++; else if (r.evpredict.risky) risky++; else { found++; stops += r.evpredict.stops.length - 2; }
  }
  routeStats.push({ vehicle: v.id, pairs: times.length, found, risky, noPlan: none, meanStops: r2(stops / Math.max(found, 1)),
    medianMs: r2(quant(times, 0.5)), p95Ms: r2(quant(times, 0.95)), maxMs: r2(Math.max(...times)) });
}
const ft: number[] = [];
for (let i = 0; i < 2000; i++) {
  const t0 = performance.now();
  E.forecastTrip({ vehicle: leaf.params, trip, personalFactor: 1.1, socStartPct: 90 });
  ft.push(performance.now() - t0);
}
const perf = { forecastMedianMs: Number(quant(ft, 0.5).toFixed(3)), cpu: cpus()[0]?.model ?? "", cores: cpus().length, node: process.version };

const result = { generated: new Date().toISOString(), shapley, reliability, routes: routeStats, perf };
const out = `${root}research/results/`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}report_numbers.json`, JSON.stringify(result, null, 2));

const c = shapley.contributions as Record<string, number>;
const md = [
  "# Числа для пояснювальної записки", "",
  "Розраховано скриптом `research/report/numbers.ts` за поточними значеннями реєстру параметрів.", "",
  "## Приклад розкладу прогнозу (п. 3.3)", "",
  `Nissan Leaf 40 кВт·год, SoH ${exampleInput.sohPct} %, k = ${fmt(exampleInput.k)}; ${exampleInput.cityKm} км містом і ${exampleInput.highwayKm} км трасою на ${exampleInput.highwaySpeedKmh} км/год, ${fmt(exampleInput.tempC, 0)} °C, набір висоти ${exampleInput.elevGainM} м.`, "",
  `Прогноз ${fmt(shapley.forecastKWh)} кВт·год = ${fmt(shapley.referenceKWh)} (еталон) ` + Object.entries(c).map(([k, x]) => `${x >= 0 ? "+" : "−"} ${fmt(Math.abs(x))} (${k})`).join(" ") + " кВт·год.", "",
  `Похибка адитивності: ${shapley.additivityErrorKWh.toExponential(1)} кВт·год.`, "",
  "## Індекс надійності на знімку реєстру (п. 3.4)", "",
  `Станцій України: ${reliability.stations}, з них постійного струму: ${reliability.dcStations}. Медіана індексу ${fmt(reliability.median)}, квартилі ${fmt(reliability.q1)} і ${fmt(reliability.q3)}, мінімум ${fmt(reliability.min)}, максимум ${fmt(reliability.max)}.`,
  `Нижче порогу ρ_min = ${fmt(rhoMin, 1)}: ${reliability.belowRhoMin}; нижче порогу включення в граф: ${reliability.belowExclusion}; станцій з відгуками: ${reliability.withCheckins}.`, "",
  "## Плани для всіх пар міст (0 °C, старт 90 %, резерв 10 %)", "",
  "| Автомобіль | Пар | Знайдено | Ризикований | Немає плану | Зупинок у середньому | Медіана, мс | 95-й процентиль, мс | Максимум, мс |",
  "|---|---|---|---|---|---|---|---|---|",
  ...routeStats.map((r) => `| ${r.vehicle} | ${r.pairs} | ${r.found} | ${r.risky} | ${r.noPlan} | ${fmt(r.meanStops as number, 1)} | ${fmt(r.medianMs as number, 1)} | ${fmt(r.p95Ms as number, 0)} | ${fmt(r.maxMs as number, 0)} |`), "",
  `Прогноз з поясненням: медіана ${fmt(perf.forecastMedianMs, 3)} мс (${perf.cpu}, ${perf.cores} ${perf.cores >= 2 && perf.cores <= 4 ? "ядра" : "ядер"}, Node.js ${perf.node}).`, "",
];
writeFileSync(`${out}report_numbers.md`, md.join("\n"));
console.log(md.join("\n"));
