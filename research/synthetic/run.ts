// Експеримент 0: перевірка механізму персоналізації і посекундного симулятора на синтетичних даних.
// Запуск: node --experimental-strip-types research/synthetic/run.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { DRIVER_PROFILES, findVehicle, generateTrips, replayHistory, SimulatedTripSource, summarize, tripEnergyWh,
  type TripInput } from "../../lib/energy/src/index.ts";

const OUT = new URL("./results/", import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const SEEDS = [11, 21, 31, 41, 51];

// A. Персоналізація: 2 автомобілі × 3 профілі × 5 зерен × 60 поїздок
const rowsA: string[] = ["vehicle,profile,mape_model,mape_k_1_10,mape_k_11_30,mape_k_31_60,k_final,reliable_share"];
const tableA: Record<string, unknown>[] = [];
for (const vid of ["fiat-500e-2013", "kia-niro-ev-64"]) {
  const v = findVehicle(vid)!.params;
  for (const d of DRIVER_PROFILES) {
    const acc = { m: [] as number[], a: [] as number[], b: [] as number[], c: [] as number[], k: [] as number[], r: [] as number[] };
    for (const seed of SEEDS) {
      const s = replayHistory(v, generateTrips(v, d, { count: 60, seed }));
      const rel = s.rows.map((r, i) => ({ ...r, i })).filter((r) => r.reliable);
      const ape = (from: number, to: number, key: "errorModelPct" | "errorPersonalPct") =>
        mean(rel.filter((r) => r.i >= from && r.i < to).map((r) => Math.abs(r[key])));
      acc.m.push(ape(0, 60, "errorModelPct")); acc.a.push(ape(0, 10, "errorPersonalPct"));
      acc.b.push(ape(10, 30, "errorPersonalPct")); acc.c.push(ape(30, 60, "errorPersonalPct"));
      acc.k.push(s.personalFactor); acc.r.push(s.reliableTrips / s.trips);
    }
    const row = { vehicle: vid, profile: d.id, mapeModel: mean(acc.m), mape1_10: mean(acc.a), mape11_30: mean(acc.b), mape31_60: mean(acc.c),
      k: mean(acc.k), kSd: Math.sqrt(mean(acc.k.map((x) => (x - mean(acc.k)) ** 2))), reliable: mean(acc.r) };
    tableA.push(row);
    rowsA.push([vid, d.id, row.mapeModel, row.mape1_10, row.mape11_30, row.mape31_60, row.k, row.reliable].map((x) => typeof x === "number" ? x.toFixed(3) : x).join(","));
  }
}
writeFileSync(OUT + "personalization.csv", rowsA.join("\n") + "\n");

// B. Посекундний симулятор: маршрут 54 км (місто – приміська – траса – місто)
const leaf = findVehicle("nissan-leaf-40")!.params;
const route = [
  { lengthKm: 8, targetKmh: 40, gradePct: 0, stopsPerKm: 1.5 }, { lengthKm: 14, targetKmh: 75, gradePct: 0.3, stopsPerKm: 0.2 },
  { lengthKm: 26, targetKmh: 110, gradePct: -0.1, stopsPerKm: 0 }, { lengthKm: 6, targetKmh: 40, gradePct: 0, stopsPerKm: 1.5 }];
const trip = (t: number): TripInput => ({ tempC: t, elevGainM: 42, elevLossM: 26, parts: [
  { type: "city", km: 14, speedKmh: 35, stopsPerKm: 1.5 }, { type: "suburban", km: 14, speedKmh: 75, stopsPerKm: 0.2 },
  { type: "highway", km: 26, speedKmh: 110, stopsPerKm: 0 }] });
const rowsB = ["temp,style,minutes,energy_kwh,wh_per_km,soc_drop,ratio_to_physics"];
const tableB: Record<string, number | string>[] = [];
for (const t of [20, 0, -10]) for (const [style, name] of [[0, "calm"], [1, "normal"], [2, "aggressive"]] as const) {
  const s = summarize(new SimulatedTripSource(leaf, route, { tempC: t, socStartPct: 90, seed: 7, style, speedNoiseKmh: 1.5 }), leaf.usableKWh);
  const phys = tripEnergyWh(leaf, trip(t)) / 1000;
  const r = { temp: t, style: name, minutes: s.minutes, energy: s.energyKWh, whkm: s.whPerKm, soc: s.socDrop, ratio: s.energyKWh / phys };
  tableB.push(r); rowsB.push(Object.values(r).map((x) => typeof x === "number" ? x.toFixed(3) : x).join(","));
}
writeFileSync(OUT + "telemetry_1hz.csv", rowsB.join("\n") + "\n");
writeFileSync(OUT + "summary.json", JSON.stringify({ personalization: tableA, telemetry: tableB }, null, 2));
console.table(tableA.map((r: any) => ({ v: r.vehicle, p: r.profile, model: r.mapeModel.toFixed(1), "1-10": r.mape1_10.toFixed(1), "11-30": r.mape11_30.toFixed(1), "31-60": r.mape31_60.toFixed(1), k: r.k.toFixed(3), sd: r.kSd.toFixed(3), rel: r.reliable.toFixed(2) })));
console.table(tableB.map((r: any) => ({ t: r.temp, s: r.style, min: r.minutes.toFixed(0), kWh: r.energy.toFixed(2), whkm: r.whkm.toFixed(0), soc: r.soc.toFixed(1), ratio: r.ratio.toFixed(3) })));
