// Знімок результатів ядра для перевірки, що зміни в коді не змінюють поведінку:
// маршрути для всіх пар міст і трьох автомобілів, прогнози з поясненням, індекс надійності станцій,
// персоналізація на синтетичній історії.
// Запуск: node --experimental-strip-types --no-warnings research/snapshot_check.ts > snapshot.json
import { readFileSync } from "node:fs";
import * as E from "../lib/energy/src/index.ts";

const stations = JSON.parse(readFileSync(new URL("../artifacts/api-server/src/data/ua_stations.json", import.meta.url), "utf8"));
const now = new Date("2026-10-10T00:00:00Z");
const out: Record<string, unknown> = {};
out.reliability = stations.map((s: E.StationRecord) => Math.round(E.reliabilityScore(s, now).score * 1e9));

const cars = ["nissan-leaf-40", "kia-niro-ev-64", "tesla-model-3-sr"].map((id) => E.findVehicle(id)!);
const routes: unknown[] = [];
const opt = (x: E.RouteOption) => [x.found, x.risky, Math.round(x.totalMinutes * 1e6), Math.round(x.arriveSocPct * 1e6),
  x.stops.map((s) => s.nodeId + ":" + (s.chargeToPct ?? ""))];
for (const v of cars) for (const a of E.UA_CITIES) for (const b of E.UA_CITIES) {
  if (a.id === b.id) continue;
  const r = E.planRoute({ from: a, to: b, vehicle: E.withStateOfHealth(v.params, 90), ratedVehicle: v.params,
    connectors: v.connectors, maxDcKw: v.maxDcKw, socStartPct: 90, reservePct: 10, tempC: 0, personalFactor: 1.05,
    stations, now });
  routes.push([v.id, a.id, b.id, r.corridorKm, opt(r.evpredict), opt(r.baseline)]);
}
out.routes = routes;

const forecasts: unknown[] = [];
for (const v of E.VEHICLE_CATALOG) for (const temp of [-15, 0, 21, 35]) {
  const f = E.forecastTrip({ vehicle: E.withStateOfHealth(v.params, 85),
    trip: { parts: [{ ...E.DEFAULT_PARTS.city, km: 12 }, { ...E.DEFAULT_PARTS.suburban, km: 20 }, { ...E.DEFAULT_PARTS.highway, km: 90 }],
      tempC: temp, elevGainM: 200, elevLossM: 150, headWindMs: 3 },
    personalFactor: 1.1, socStartPct: 80, lang: "uk", historyRatios: [0.95, 1.02, 1.1, 1.05, 0.98, 1.2, 1.01] });
  forecasts.push([v.id, temp, f.energyKWh, f.baseKWh, f.energyLowKWh, f.energyHighKWh, f.status,
    f.contributions.map((c) => c.kWh), f.explanation, f.whatIf.map((w) => [w.id, w.energyKWh])]);
}
out.forecasts = forecasts;

const leaf = E.findVehicle("nissan-leaf-40")!;
const trips = E.generateTrips(leaf.params, E.DRIVER_PROFILES[1], { count: 40, seed: 7 });
const rep = E.replayHistory(leaf.params, trips);
out.replay = [rep.personalFactor, rep.roadFactors, rep.mapePersonalPct,
  E.safetyFromHistory(rep.personalFactor, rep.ratios), E.safetyFromHistory(1, rep.ratios.slice(0, 7))];
console.log(JSON.stringify(out));
