import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VEHICLE_CATALOG, findVehicle, segmentEnergyWh, updatePersonalFactor, DEFAULT_PARTS, tripEnergyWh, validateTrip,
  explainShapley, FACTORS, forecastTrip, generateTrips, DRIVER_PROFILES, replayHistory, SimulatedTripSource, summarize,
  buildGraph, plan, reliefEnergyWh, type TripInput, safetyFromHistory, DEFAULT_SAFETY, predictionInterval, dcPowerKw, chargeTimeH, num, list,
} from "../src/index.ts";

const fiat = findVehicle("fiat-500e-2013")!.params;
const winterHighway: TripInput = {
  parts: [{ ...DEFAULT_PARTS.city, km: 8 }, { ...DEFAULT_PARTS.highway, km: 70 }],
  tempC: -5, elevGainM: 350, elevLossM: 260,
};

test("каталог містить коректні параметри", () => {
  assert.ok(VEHICLE_CATALOG.length >= 8);
  for (const v of VEHICLE_CATALOG) {
    assert.ok(v.params.usableKWh > 10 && v.params.massKg > 1000 && v.params.cd > 0.2 && v.params.cd < 0.4, v.id);
  }
});

test("фізична модель: споживання зростає зі швидкістю та на холоді, спуск дає рекуперацію", () => {
  const e = (v: number, t: number, g = 0) => segmentEnergyWh(fiat, { lengthM: 10000, speedMs: v / 3.6, gradePct: g, tempC: t }).energyWh;
  assert.ok(e(130, 20) > e(90, 20) && e(90, 20) > e(70, 20));
  assert.ok(e(50, -10) > e(50, 20));
  assert.ok(e(90, 20, -4) < 0);
});

test("значення Шеплі адитивні: еталон + Σφ = прогноз", () => {
  for (const k of [0.9, 1, 1.15]) {
    const ex = explainShapley(fiat, winterHighway, k);
    const sum = FACTORS.reduce((s, f) => s + ex.phi[f], 0);
    assert.ok(Math.abs(ex.baseWh + sum - ex.predWh) < 1e-6);
    assert.ok(Math.abs(ex.predWh - tripEnergyWh(fiat, winterHighway) * k) < 1e-6);
  }
});

test("пояснення монотонне: вища швидкість не зменшує внесок швидкості", () => {
  const faster = { ...winterHighway, parts: winterHighway.parts.map((p) => p.type === "highway" ? { ...p, speedKmh: 130 } : p) };
  assert.ok(explainShapley(fiat, faster, 1).phi.speed > explainShapley(fiat, winterHighway, 1).phi.speed);
  const colder = { ...winterHighway, tempC: -15 };
  assert.ok(explainShapley(fiat, colder, 1).phi.weather > explainShapley(fiat, winterHighway, 1).phi.weather);
});

test("прогноз: статус, інтервал, сценарії «що буде, якщо»", () => {
  const f = forecastTrip({ vehicle: fiat, trip: winterHighway, socStartPct: 90, lang: "uk" });
  assert.ok(f.energyKWh > 0 && f.energyLowKWh < f.energyKWh && f.energyHighKWh > f.energyKWh);
  assert.equal(Math.round(f.socArrivePct * 1000), Math.round((90 - f.socUsedPct) * 1000));
  assert.ok(["ok", "tight", "insufficient"].includes(f.status));
  const slower = f.whatIf.find((w) => w.id === "highway-slower")!;
  assert.ok(slower.deltaKWh < 0 && slower.deltaMinutes > 0);
  assert.ok(f.explanation.length >= 1 && f.explanation.length <= 3);
  const empty = forecastTrip({ vehicle: fiat, trip: winterHighway, socStartPct: 20 });
  assert.equal(empty.status, "insufficient");
});

test("валідація поїздки відхиляє некоректні дані", () => {
  assert.ok(validateTrip({ parts: [], tempC: 20, elevGainM: 0, elevLossM: 0 }).length > 0);
  assert.ok(validateTrip({ ...winterHighway, tempC: 80 }).length > 0);
  assert.equal(validateTrip(winterHighway).length, 0);
});

test("коефіцієнт k обмежений і згладжений", () => {
  assert.ok(Math.abs(updatePersonalFactor(1, 10, 5, 0.2) - 1.2) < 1e-12);
  assert.ok(Math.abs(updatePersonalFactor(1, 100, 5, 0.2) - 1.2) < 1e-12); // clip до 2.0
  assert.ok(Math.abs(updatePersonalFactor(1, 1, 5, 0.2) - 0.9) < 1e-12); // clip до 0.5
});

test("симулятор відтворюваний, персоналізація зменшує похибку для нетипового водія", () => {
  const dyn = DRIVER_PROFILES.find((d) => d.id === "dynamic")!;
  const a = generateTrips(fiat, dyn, { count: 40, seed: 7 });
  const b = generateTrips(fiat, dyn, { count: 40, seed: 7 });
  assert.deepEqual(a, b);
  const r = replayHistory(fiat, a);
  assert.equal(r.trips, 40);
  assert.ok(r.personalFactor > 1.05);
  assert.ok(r.mapePersonalLast10Pct! < r.mapeModelPct);
});

test("посекундний симулятор: SoC зменшується, енергія узгоджена з SoC", () => {
  const src = new SimulatedTripSource(fiat, [{ lengthKm: 5, targetKmh: 50, gradePct: 0, stopsPerKm: 1.5 }],
    { tempC: 10, socStartPct: 80, seed: 1, style: 1, speedNoiseKmh: 0 });
  const s = summarize(src, fiat.usableKWh);
  assert.ok(s.socDrop > 0 && s.km > 4.9);
  assert.ok(Math.abs(s.energyKWh - (s.socDrop / 100) * fiat.usableKWh) < 0.05);
});

test("маршрутизація RCSPP знаходить допустимий маршрут із заряджанням", () => {
  const g = buildGraph(
    [{ id: "A", x: 0, y: 0, elevM: 100 }, { id: "C", x: 100, y: 0, elevM: 100, chargerKW: 50 }, { id: "B", x: 200, y: 0, elevM: 100 }],
    [{ from: "A", to: "C", lengthKm: 100, speedKmh: 90 }, { from: "C", to: "B", lengthKm: 100, speedKmh: 90 }]);
  const r = plan(g, "A", "B", fiat, { tempC: 20, socStart: 0.9, socMin: 0.1, socArriveMin: 0.1,
    chargeTargets: [0.6, 0.8, 1.0], personalFactor: 1, useHeuristic: true, vMaxKmh: 90 });
  assert.ok(r.label && r.label.soc >= 0.1);
});

test("синтетичні поїздки фізично коректні для автомобіля з малою батареєю", () => {
  for (const d of DRIVER_PROFILES) for (const r of generateTrips(fiat, d, { count: 60, seed: 11 })) {
    assert.ok(r.socEndPct >= 0 && r.socStartPct <= 100 && r.socEndPct < r.socStartPct, r.id);
  }
});

test("короткі поїздки з неточними показами SoC не впливають на k", () => {
  const recs = generateTrips(fiat, DRIVER_PROFILES[2], { count: 30, seed: 5 });
  const r = replayHistory(fiat, recs);
  for (const row of r.rows) if (!row.reliable) assert.equal(row.kAfter, row.kBefore);
  assert.ok(r.reliableTrips < r.trips || r.rows.every((x) => x.reliable));
});

import { reliabilityScore, buildCorridorGraph, planBaseline, labelToPlan, executePlan, fitRoadFactors, haversineKm as hav } from "../src/index.ts";

const station = (o: Partial<import("../src/index.ts").StationRecord>) => ({ id: 1, title: "", town: "", lat: 50, lon: 30, maxKw: 50, dc: true,
  connectors: ["CCS"], points: 1, statusTypeId: 50, lastVerified: "2026-06-01T00:00:00Z", checkinsOk: 0, checkinsFailed: 0, ...o });

test("надійність станції: свіжа перевірка і кілька точок підвищують, старі дані й невдалі відгуки знижують", () => {
  const now = new Date("2026-10-01");
  const fresh = reliabilityScore(station({}), now).score;
  assert.ok(reliabilityScore(station({ lastVerified: "2019-01-01T00:00:00Z" }), now).score < fresh);
  assert.ok(reliabilityScore(station({ checkinsFailed: 1 }), now).score < fresh);
  assert.ok(reliabilityScore(station({ points: 3 }), now).score > fresh);
  assert.ok(reliabilityScore(station({ statusTypeId: 100 }), now).score < 0.2);
});

test("граф коридору: лише сумісні DC-станції поблизу прямої, ребра лише вперед", () => {
  const a = { id: "A", lat: 50.45, lon: 30.52 }, b = { id: "B", lat: 49.84, lon: 24.03 };
  const st = [station({ id: 1, lat: 50.25, lon: 28.66 }), station({ id: 2, lat: 50.25, lon: 28.66, connectors: ["CHAdeMO"] }),
    station({ id: 3, lat: 46.48, lon: 30.72 }), station({ id: 4, lat: 50.25, lon: 28.66, dc: false })];
  const { graph, nodes } = buildCorridorGraph(a, b, st, { corridorKm: 30, circuity: 1.25, maxEdgeKm: 800, highwayKmh: 90,
    connectors: ["CCS"], vehicleMaxDcKw: 100 });
  assert.deepEqual(nodes.map((n) => n.id).sort(), ["A", "B", "s1"]);
  assert.ok(graph.adj.get("B")!.length === 0 && graph.adj.get("s1")!.every((e) => e.to === "B"));
  assert.ok(Math.abs(graph.adj.get("A")!.find((e) => e.to === "B")!.lengthKm - hav(a.lat, a.lon, b.lat, b.lon) * 1.25) < 1e-9);
});

test("базовий планувальник і RCSPP знаходять план, виконання з перепрогнозуванням обходить непрацюючу станцію", () => {
  const nodes = [
    { id: "A", x: 0, y: 0, elevM: 0, lat: 50, lon: 30 }, { id: "S1", x: 100, y: 0, elevM: 0, chargerKW: 50, lat: 50, lon: 31.4, reliability: 0.9 },
    { id: "S2", x: 105, y: 0, elevM: 0, chargerKW: 50, lat: 50, lon: 31.47, reliability: 0.9 }, { id: "B", x: 200, y: 0, elevM: 0, lat: 50, lon: 32.8 }];
  const edges = [["A", "S1", 160], ["A", "S2", 165], ["S1", "S2", 5], ["S1", "B", 160], ["S2", "B", 155]].map(([f, t, km]) => ({ from: f as string, to: t as string, lengthKm: km as number, speedKmh: 90 }));
  const g = buildGraph(nodes, edges, true);
  const p = findVehicle("nissan-leaf-40")!.params;
  const base = planBaseline(g, "A", "B", p, { whPerKm: 160, socStart: 0.9, socMin: 0.1, chargeTo: 0.8 })!;
  assert.ok(base && base.steps.some((s) => s.chargeTo));
  const o = { tempC: 20, socStart: 0.9, socMin: 0.1, socArriveMin: 0.1, chargeTargets: [0.6, 0.8], personalFactor: 1, useHeuristic: true, vMaxKmh: 90 };
  const r = plan(g, "A", "B", p, o); const pl = labelToPlan(r.label, r.expanded)!;
  const stop = pl.steps.find((s) => s.chargeTo)!.node;
  const world = { vehicle: p, driver: DRIVER_PROFILES[1], tempC: 20, headWindMs: 0, circuity: 1.25, edgeNoise: () => 1,
    stationWorks: (id: string) => id !== stop };
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const res = executePlan(pl, g, nodeMap, world, 0.9, 0.1, { replan: (from, soc, exclude) => {
    const rr = plan(g, from, "B", p, { ...o, socStart: soc, exclude }); return labelToPlan(rr.label, rr.expanded); } });
  assert.equal(res.failedStations, 1);
  assert.equal(res.replans, 1);
  assert.ok(res.completed);
});

test("персональні коефіцієнти за типами доріг відрізняють міську і трасову поведінку", () => {
  const dyn = DRIVER_PROFILES.find((d) => d.id === "dynamic")!;
  const kia = findVehicle("kia-niro-ev-64")!.params;
  const rf = fitRoadFactors(kia, generateTrips(kia, dyn, { count: 60, seed: 3 }), 1.15);
  assert.ok(rf.city > 1.05 && rf.highway > 1.05);
});

test("планувальник маршруту: без DC-заряджання і великої відстані плану немає, з DC — є", async () => {
  const { planRoute } = await import("../src/route-planner.ts");
  const { findVehicle } = await import("../src/vehicles.ts");
  const A = { id: "a", lat: 50, lon: 30 }, B = { id: "b", lat: 50, lon: 34.5 }; // ≈ 320 км по прямій
  const st = [1, 2, 3].map((i) => ({ id: i, title: `S${i}`, town: "", lat: 50, lon: 30 + i * 1.1, maxKw: 50, dc: true, connectors: ["CCS"],
    points: 2, statusTypeId: 50, lastVerified: "2026-01-01T00:00:00Z", checkinsOk: 0, checkinsFailed: 0 }));
  const go = (id: string) => { const m = findVehicle(id)!; return planRoute({ from: A, to: B, vehicle: m.params, ratedVehicle: m.params,
    connectors: m.connectors, maxDcKw: m.maxDcKw, socStartPct: 90, reservePct: 10, tempC: 10, personalFactor: 1, stations: st, now: new Date("2026-10-01") }); };
  assert.equal(go("fiat-500e-2013").evpredict.found, false);
  const r = go("chevrolet-bolt");
  assert.ok(r.evpredict.found && r.evpredict.minSocPct >= 10 - 1e-6 && r.evpredict.stops.length >= 3);
});

test("запас σ та інтервал прогнозу: за історією водія, без історії – типові значення", () => {
  assert.equal(safetyFromHistory(1.1, [1.1, 1.2]), DEFAULT_SAFETY);                 // < 10 поїздок
  const stable = Array.from({ length: 20 }, () => 1.0);
  assert.equal(safetyFromHistory(1.0, stable), 1.03);                                // нижня межа
  const noisy = Array.from({ length: 20 }, (_, i) => 0.8 + i * 0.03);                // 0,80…1,37
  const s = safetyFromHistory(1.0, noisy);
  assert.ok(s > 1.2 && s <= 1.5, String(s));                                         // нестабільний водій – більший запас
  assert.deepEqual(predictionInterval(1, [1, 1]), list("defaultInterval"));
  const [lo, hi] = predictionInterval(1.0, noisy);
  assert.ok(lo <= 0.97 && hi >= 1.03 && lo < hi);
  // конформні межі: з 20 значень беремо 2-ге і 19-те (⌊21·0,1⌋ і ⌈21·0,9⌉)
  assert.ok(Math.abs(lo - 0.83) < 1e-9 && Math.abs(hi - 1.34) < 1e-9, `${lo} ${hi}`);
  assert.ok(Math.abs(s - 1.34) < 1e-9);
});

test("текстове пояснення: лише числа розрахунку, найбільші внески, типографський мінус", () => {
  const f = forecastTrip({ vehicle: fiat, trip: winterHighway, socStartPct: 90, personalFactor: 1.15, lang: "uk" });
  const top = [...f.contributions].sort((a, b) => Math.abs(b.kWh) - Math.abs(a.kWh))[0];
  assert.ok(f.explanation[0].startsWith(top.label[0].toUpperCase()));
  assert.ok(f.explanation[0].includes(Math.abs(top.kWh).toFixed(1).replace(".", ",")));
  assert.ok(f.explanation.every((x) => !/-\d/.test(x)), f.explanation.join(" | "));
});

test("коридор пошуку станцій розширюється, якщо у вузькому коридорі допустимого плану немає", async () => {
  const { planRoute } = await import("../src/route-planner.ts");
  const m = findVehicle("nissan-leaf-40")!;
  const A = { id: "a", lat: 50, lon: 30 }, B = { id: "b", lat: 50, lon: 34.5 };
  // станції ≈ 45 км на північ від прямої A–B: поза коридором 30 км, але в коридорі 60 км
  const st = [1, 2, 3].map((i) => station({ id: i, lat: 50.4, lon: 30 + i * 1.1, connectors: ["CHAdeMO"], points: 2 }));
  const r = planRoute({ from: A, to: B, vehicle: m.params, ratedVehicle: m.params, connectors: m.connectors, maxDcKw: m.maxDcKw,
    socStartPct: 90, reservePct: 10, tempC: 10, personalFactor: 1, stations: st, now: new Date("2026-10-01") });
  assert.equal(r.corridorKm, 60);
  assert.ok(r.evpredict.found && !r.evpredict.risky && r.evpredict.stops.some((s) => s.kind === "station"));
});

test("власна AC-точка: авто без DC отримує план, потужність обмежена бортовим зарядним пристроєм", async () => {
  const { planRoute } = await import("../src/route-planner.ts");
  const m = findVehicle("fiat-500e-2013")!;
  const A = { id: "a", lat: 50, lon: 30 }, B = { id: "b", lat: 50, lon: 31.6 }; // ≈ 115 км по прямій, ≈ 143 км дорогою
  const own = { ...station({ id: 1, lat: 50.02, lon: 30.8, connectors: [] }), maxKw: 11, dc: false, own: true, statusTypeId: null, lastVerified: null };
  const go = (st: typeof own[]) => planRoute({ from: A, to: B, vehicle: m.params, ratedVehicle: m.params, connectors: m.connectors,
    maxDcKw: m.maxDcKw, maxAcKw: m.maxAcKw, socStartPct: 100, reservePct: 10, tempC: 10, personalFactor: 1, stations: st, now: new Date("2026-10-01") });
  assert.equal(go([]).evpredict.found, false);
  const r = go([own]);
  const stop = r.evpredict.stops.find((s) => s.kind === "station")!;
  assert.ok(r.evpredict.found && !r.evpredict.risky && stop.own && stop.ac && stop.reliabilityPct === 100);
  assert.equal(stop.maxKw, m.maxAcKw);                                          // 6,6 кВт бортового пристрою, а не 11 кВт точки
  const kwh = (m.params.usableKWh * (stop.chargeToPct! - stop.socArrivePct)) / 100;
  assert.ok(Math.abs(stop.chargeMinutes! - ((kwh / m.maxAcKw) * 60 + num("connectMinutes"))) < 2, String(stop.chargeMinutes));
  // власна DC-точка не використовується автомобілем без DC
  assert.equal(go([{ ...own, dc: true }]).evpredict.found, false);
});

test("індекс надійності: станція нижче порогу не використовується, штраф обирає надійнішу з близьких за часом", () => {
  const p = findVehicle("nissan-leaf-40")!.params;
  const mk = (relS1: number) => buildGraph([
    { id: "A", x: 0, y: 0, elevM: 0 }, { id: "S1", x: 100, y: 0, elevM: 0, chargerKW: 50, reliability: relS1 },
    { id: "S2", x: 100, y: 10, elevM: 0, chargerKW: 50, reliability: 0.95 }, { id: "B", x: 200, y: 0, elevM: 0 }],
    [{ from: "A", to: "S1", lengthKm: 150, speedKmh: 90 }, { from: "A", to: "S2", lengthKm: 155, speedKmh: 90 },
     { from: "S1", to: "B", lengthKm: 150, speedKmh: 90 }, { from: "S2", to: "B", lengthKm: 155, speedKmh: 90 }], true);
  const o = { tempC: 20, socStart: 0.9, socMin: 0.1, socArriveMin: 0.1, chargeTargets: [0.5, 0.6, 0.7, 0.8, 0.9], personalFactor: 1, useHeuristic: true, vMaxKmh: 90 };
  const stopOf = (g: ReturnType<typeof mk>, extra: object) => labelToPlan(plan(g, "A", "B", p, { ...o, ...extra }).label, 0)!.steps.find((s) => s.chargeTo)!.node;
  assert.equal(stopOf(mk(0.4), {}), "S1");                                   // без урахування надійності – коротший шлях
  assert.equal(stopOf(mk(0.4), { minReliability: 0.5 }), "S2");              // поріг ρ_min
  assert.equal(stopOf(mk(0.6), { minReliability: 0.5 }), "S1");              // вище порогу, штрафу немає
  assert.equal(stopOf(mk(0.6), { minReliability: 0.5, failurePenaltyH: 0.75 }), "S2"); // (0,95 − 0,6)·0,75 год ≈ 16 хв більше за різницю в часі
});

test("маршрут: підйом до пункту призначення і зустрічний вітер збільшують енергію, спуск і попутний вітер зменшують", async () => {
  const { planRoute } = await import("../src/route-planner.ts");
  const m = findVehicle("kia-niro-ev-64")!;
  const st = [1, 2, 3].map((i) => station({ id: i, lat: 50, lon: 30 + i * 1.1, connectors: ["CCS"], points: 2 }));
  const go = (fromElev: number, toElev: number, headWindMs?: number) => planRoute({
    from: { id: "a", lat: 50, lon: 30, elevM: fromElev }, to: { id: "b", lat: 50, lon: 34.5, elevM: toElev },
    vehicle: m.params, ratedVehicle: m.params, connectors: m.connectors, maxDcKw: m.maxDcKw, socStartPct: 90, reservePct: 10,
    tempC: 10, headWindMs, personalFactor: 1, stations: st, now: new Date("2026-10-01") }).evpredict;
  const flat = go(0, 0), up = go(0, 600), down = go(600, 0), head = go(0, 0, 6), tail = go(0, 0, -6);
  assert.ok(flat.found && up.found && down.found && head.found && tail.found);
  assert.equal(flat.climbM, 0);
  assert.ok(up.energyKWh > flat.energyKWh && down.energyKWh < flat.energyKWh);
  assert.ok(Math.abs(up.climbM - 600) < 1e-9 && Math.abs(down.descentM - 600) < 1e-9);
  // підйом на 600 м для авто масою 1840 кг: m·g·h / ККД ≈ 3,6 кВт·год (без урахування k)
  assert.ok(Math.abs(up.energyKWh - flat.energyKWh - (1840 * 9.81 * 600) / num("drivetrainEff") / 3.6e6) < 0.05);
  assert.ok(head.energyKWh > flat.energyKWh && tail.energyKWh < flat.energyKWh);
});

test("вітер: азимут, складова назустріч руху, середній вектор", async () => {
  const { bearingDeg, headWindComponent, meanWind } = await import("../src/stations.ts");
  assert.ok(Math.abs(bearingDeg({ lat: 50, lon: 30 }, { lat: 51, lon: 30 })) < 1e-9);            // на північ
  assert.ok(Math.abs(bearingDeg({ lat: 50, lon: 30 }, { lat: 50, lon: 31 }) - 90) < 0.5);       // на схід
  const west = { speedMs: 5, fromDeg: 270 };
  assert.ok(Math.abs(headWindComponent(west, 270) - 5) < 1e-9);                                 // рух на захід – зустрічний
  assert.ok(Math.abs(headWindComponent(west, 90) + 5) < 1e-9);                                  // на схід – попутний
  assert.ok(Math.abs(headWindComponent(west, 0)) < 1e-9);                                       // боковий
  const m = meanWind([west, { speedMs: 5, fromDeg: 90 }]);                                      // протилежні вітри гасять один одного
  assert.ok(m.speedMs < 1e-9);
  const n = meanWind([{ speedMs: 4, fromDeg: 350 }, { speedMs: 4, fromDeg: 10 }]);               // усереднення через північ
  assert.ok(Math.abs(n.speedMs - 4 * Math.cos((10 * Math.PI) / 180)) < 1e-9 && (n.fromDeg < 1e-6 || n.fromDeg > 360 - 1e-6));
});

test("маршрут: вітер з напрямком рахується для кожної ділянки за її азимутом", async () => {
  const { planRoute } = await import("../src/route-planner.ts");
  const m = findVehicle("kia-niro-ev-64")!;
  const st = [1, 2, 3].map((i) => station({ id: i, lat: 50, lon: 30 + i * 1.1, connectors: ["CCS"], points: 2 }));
  const go = (wind?: { speedMs: number; fromDeg: number }) => planRoute({ from: { id: "a", lat: 50, lon: 30 }, to: { id: "b", lat: 50, lon: 34.5 },
    vehicle: m.params, ratedVehicle: m.params, connectors: m.connectors, maxDcKw: m.maxDcKw, socStartPct: 90, reservePct: 10,
    tempC: 10, wind, personalFactor: 1, stations: st, now: new Date("2026-10-01") }).evpredict;
  const calm = go(), fromEast = go({ speedMs: 6, fromDeg: 90 }), fromWest = go({ speedMs: 6, fromDeg: 270 }), side = go({ speedMs: 6, fromDeg: 0 });
  assert.ok(fromEast.energyKWh > calm.energyKWh && fromWest.energyKWh < calm.energyKWh);       // маршрут на схід
  assert.ok(Math.abs(side.energyKWh - calm.energyKWh) / calm.energyKWh < 0.01);                  // боковий вітер майже не впливає
});

test("симулятор виконання: рельєф і вітер у «справжньому» світі; планувальник, що знає рельєф, прогнозує прибуття точно", async () => {
  const { executePlan } = await import("../src/execution.ts");
  const m = findVehicle("kia-niro-ev-64")!;
  const p = m.params;
  const normal = DRIVER_PROFILES.find((d) => d.id === "normal")!;
  const A = { id: "A", lat: 50, lon: 30, elevM: 0 }, B = { id: "B", lat: 50, lon: 34.5, elevM: 800 };
  const st = [1, 2, 3].map((i) => station({ id: i, lat: 50, lon: 30 + i * 1.1, connectors: ["CCS"], points: 2, elevM: i * 200 }));
  const { graph, nodes } = buildCorridorGraph(A, B, st, { corridorKm: 30, circuity: 1.25, maxEdgeKm: 450, highwayKmh: 90,
    connectors: m.connectors, vehicleMaxDcKw: m.maxDcKw, now: new Date("2026-10-01") });
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const stops = (km: number) => (km > num("highwayEdgeMinKm") ? num("edgeStopsHighway") : num("edgeStopsCity"));
  const edge = (relief: boolean) => (e: { from: string; to: string; lengthKm: number; speedKmh: number }) => {
    const dh = nodeMap.get(e.to)!.elevM - nodeMap.get(e.from)!.elevM;
    return segmentEnergyWh(p, { lengthM: e.lengthKm * 1000, speedMs: e.speedKmh / 3.6, gradePct: 0, tempC: 10, stopsPerKm: stops(e.lengthKm) }).energyWh
      + (relief ? reliefEnergyWh(p, Math.max(dh, 0), Math.max(-dh, 0)) : 0);
  };
  const mk = (relief: boolean) => labelToPlan(plan(graph, "A", "B", p, { tempC: 10, socStart: 0.9, socMin: 0.1, socArriveMin: 0.1,
    chargeTargets: [0.6, 0.8, 0.9], personalFactor: 1, useHeuristic: false, vMaxKmh: 90, edgeEnergy: edge(relief) }).label, 0)!;
  const world = (extra: object) => ({ vehicle: p, driver: normal, tempC: 10, headWindMs: 0, edgeNoise: () => 1, stationWorks: () => true, circuity: 1.25, ...extra });
  const aware = mk(true), flat = mk(false);
  const ra = executePlan(aware, graph, nodeMap, world({ relief: true }), 0.9, 0.1);
  const rf = executePlan(flat, graph, nodeMap, world({ relief: true }), 0.9, 0.1);
  assert.ok(ra.completed && Math.abs(ra.arriveSoc - aware.plannedArriveSoc) < 1e-6);            // модель = «справжній» світ
  assert.ok(rf.arriveSoc < flat.plannedArriveSoc - 0.02);                                        // без рельєфу – прибуття з меншим зарядом, ніж обіцяно
  // попутний західний вітер на маршруті на схід: у «справжньому» світі заряду лишається більше
  const tail = executePlan(aware, graph, nodeMap, world({ relief: true, wind: { speedMs: 6, fromDeg: 270 } }), 0.9, 0.1);
  assert.ok(tail.arriveSoc > ra.arriveSoc);
});

test("стан батареї: доступна ємність пропорційна SoH у межах від мінімального SoH до 100 %", async () => {
  const { withStateOfHealth } = await import("../src/vehicles.ts");
  const p = findVehicle("nissan-leaf-40")!.params;
  assert.ok(Math.abs(withStateOfHealth(p, 75).usableKWh - p.usableKWh * 0.75) < 1e-9);
  assert.ok(Math.abs(withStateOfHealth(p, 20).usableKWh - p.usableKWh * 0.4) < 1e-9);      // нижче мінімуму – мінімум 40 %
  assert.equal(withStateOfHealth(p, 120).usableKWh, p.usableKWh);
});

test("ручне введення як джерело телеметрії: дві точки, енергія і зниження SoC", async () => {
  const { ManualEntrySource } = await import("../src/telemetry.ts");
  const s0 = { t: 0, distanceM: 0, speedKmh: 0, accelMs2: 0, elevM: 100, tempC: 5, socPct: 80, powerKw: 0 };
  const s1 = { ...s0, t: 1800, distanceM: 25000, socPct: 70, powerKw: 0 };
  const sum = summarize(new ManualEntrySource(s0, s1), 40);
  assert.equal(sum.samples, 2);
  assert.equal(sum.km, 25);
  assert.equal(sum.socDrop, 10);
  assert.equal(sum.minutes, 30);
});

test("симулятор виконання: непрацююча станція без перепланування – об'їзд до сусідньої; нестача енергії – розряд у дорозі", async () => {
  const { executePlan } = await import("../src/execution.ts");
  const m = findVehicle("kia-niro-ev-64")!;
  const p = m.params, normal = DRIVER_PROFILES.find((d) => d.id === "normal")!;
  const A = { id: "A", lat: 50, lon: 30.5 }, B = { id: "B", lat: 50, lon: 36.5 };
  // дві станції на відстані ≈ 7 км одна від одної посередині маршруту
  const st = [station({ id: 1, lat: 50, lon: 33.5, connectors: ["CCS"], points: 2 }), station({ id: 2, lat: 50.05, lon: 33.55, connectors: ["CCS"], points: 2 })];
  const { graph, nodes } = buildCorridorGraph(A, B, st, { corridorKm: 30, circuity: 1.25, maxEdgeKm: 450, highwayKmh: 90,
    connectors: m.connectors, vehicleMaxDcKw: m.maxDcKw, now: new Date("2026-10-01") });
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const r = plan(graph, "A", "B", p, { tempC: 10, socStart: 0.9, socMin: 0.1, socArriveMin: 0.1, chargeTargets: [0.8, 0.9], personalFactor: 1, useHeuristic: false, vMaxKmh: 90 });
  const pl = labelToPlan(r.label, 0)!;
  const used = pl.steps.find((s) => s.chargeTo !== undefined)!.node;
  const world = { vehicle: p, driver: normal, tempC: 10, headWindMs: 0, circuity: 1.25, edgeNoise: () => 1, stationWorks: (id: string) => id !== used };
  const res = executePlan(pl, graph, nodeMap, world, 0.9, 0.1);
  assert.ok(res.completed && res.failedStations === 1 && res.detours === 1 && res.chargeStops === 1);
  // «справжнє» споживання втричі вище за модель – розряд на першій же ділянці
  const bad = executePlan(pl, graph, nodeMap, { ...world, stationWorks: () => true, edgeNoise: () => 3 }, 0.9, 0.1);
  assert.ok(!bad.completed && bad.minSoc < 0 && bad.belowReserve);
});

test("довідник автомобілів збігається з витягом Open EV Data, крива задає час заряджання", () => {
  const oed = JSON.parse(readFileSync(new URL("../../../research/params/data/oed_vehicles.json", import.meta.url), "utf8")).vehicles;
  for (const m of VEHICLE_CATALOG) {
    const o = oed[m.id];
    assert.equal(m.params.usableKWh, o.usable_kwh, m.id);
    if (m.maxDcKw > 0) {
      assert.equal(m.maxDcKw, o.dc_max_kw, m.id);
      assert.deepEqual(m.params.dcCurve, o.curve, m.id);
    }
  }
  // маса, C_d і площа міделя – з research/params/vehicle_specs.py
  const specs = JSON.parse(readFileSync(new URL("../../../research/params/results/vehicle_specs.json", import.meta.url), "utf8")).vehicles;
  for (const m of VEHICLE_CATALOG) {
    const v = specs[m.id];
    assert.deepEqual([m.params.massKg, m.params.cd, m.params.frontalAreaM2], [v.massKg, v.cd, v.frontalAreaM2], m.id);
  }
  const leaf = findVehicle("nissan-leaf-40")!.params;
  assert.equal(dcPowerKw(leaf, 50, 0.3), Math.min(50, 41 + (4 * 30) / 62));
  assert.equal(dcPowerKw(leaf, 22, 0.3), 22);
  const generic = { ...leaf, dcCurve: undefined };
  assert.equal(dcPowerKw(generic, 100, 0.2), 100);
  assert.ok(Math.abs(dcPowerKw(generic, 100, 0.85) - 42.5) < 1e-9);
  assert.ok(chargeTimeH(leaf, 50, 0.1, 0.8) > chargeTimeH(leaf, 50, 0.1, 0.6));
});
