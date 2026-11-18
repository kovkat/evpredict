// Експеримент 2: рекомендація маршруту і заряджань — EVPredict проти базового планувальника на Дейкстрі.
// Реальні станції України (Open Charge Map), реальні міста, кліматичні температури Києва,
// прихований стиль водіння і станції, що можуть не працювати.
// Світ WORLD=ua додає до «справжнього» світу рельєф (висоти міст і станцій з Copernicus DEM) і вітер з напрямком,
// а до порівняння – варіант EVPredict, який знає прогноз вітру (з похибкою) і висоти вузлів.
// Запуск: node --experimental-strip-types research/benchmark/run.ts [кількість поїздок] [seed] [bias]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  type StationRecord, type DriverProfile, type TripPlan, type VehicleParams, type Connector,
  DRIVER_PROFILES, VEHICLE_CATALOG, buildCorridorGraph, buildGraph, createRng, executePlan, generateTrips, haversineKm,
  type Adaptation, labelToPlan, safetyFromHistory, plan, planBaseline, replayHistory, segmentEnergyWh, withStateOfHealth, num, list,
  UA_CITIES, type Wind, bearingDeg, headWindComponent, reliefEnergyWh,
} from "../../lib/energy/src/index.ts";

const N = Number(process.argv[2] ?? 400);
const SEED = Number(process.argv[3] ?? 2026);
// стресовий сценарій: фактичне споживання систематично вище за будь-який прогноз (частка, напр. 0,15)
const BIAS = Number(process.argv[4] ?? 0);
// параметр штрафу за ненадійність станції T_f, год (аналіз чутливості)
const TF = Number(process.env.TF ?? num("failurePenaltyH"));
// світ з рельєфом і вітром із напрямком
const UA = process.env.WORLD === "ua";
const TAG = (UA ? "ua_" : "") + (BIAS ? `bias${Math.round(BIAS * 100)}_` : "") + (process.env.TF ? `tf${Math.round(TF * 100)}_` : "");
const here = new URL(".", import.meta.url).pathname;
const stations: StationRecord[] = JSON.parse(readFileSync(`${here}../stations/data/ua_stations.json`, "utf8"));
const NOW = new Date("2026-10-01T00:00:00Z");

const CITIES: [string, number, number][] = [
  ["Київ", 50.4501, 30.5234], ["Львів", 49.8397, 24.0297], ["Одеса", 46.4825, 30.7233], ["Харків", 49.9935, 36.2304],
  ["Дніпро", 48.4647, 35.0462], ["Житомир", 50.2547, 28.6587], ["Вінниця", 49.2331, 28.4682], ["Полтава", 49.5883, 34.5514],
  ["Суми", 50.9077, 34.7981], ["Чернігів", 51.4982, 31.2893], ["Умань", 48.7484, 30.2218], ["Рівне", 50.6199, 26.2516],
  ["Тернопіль", 49.5535, 25.5948], ["Хмельницький", 49.4229, 26.9871], ["Черкаси", 49.4444, 32.0598],
  ["Кропивницький", 48.5079, 32.2623], ["Миколаїв", 46.975, 31.9946], ["Запоріжжя", 47.8388, 35.1396],
  ["Івано-Франківськ", 48.9226, 24.7111], ["Луцьк", 50.7472, 25.3254], ["Чернівці", 48.2921, 25.9358],
];
const MONTH_TEMP = [-4, -3, 2, 9, 15, 19, 21, 20, 15, 9, 3, -2];
const FLEET: { id: string; soh: number }[] = [
  { id: "nissan-leaf-40", soh: 85 }, { id: "chevrolet-bolt", soh: 90 }, { id: "kia-niro-ev-64", soh: 92 },
  { id: "tesla-model-3-sr", soh: 95 }, { id: "vw-id4-77", soh: 95 },
];
const CIRCUITY = num("circuity"), SOC_START = 0.9, RESERVE = num("arriveReserveDefaultPct") / 100;
const HW_KM = num("highwayEdgeMinKm"), V_HW = num("edgeSpeedHighway");


type PlannerId = "naive" | "baseline" | "physics" | "personal" | "full" | "weather";
const PLANNERS: PlannerId[] = ["naive", "baseline", "physics", "personal", "full", ...(UA ? ["weather" as const] : [])];
const cityElev = new Map(UA_CITIES.map((c) => [c.name, c.elevM]));
const rows: Record<string, unknown>[] = [];
const rng = createRng(SEED);

for (let trip = 0; trip < N; trip++) {
  let a: (typeof CITIES)[number], b: (typeof CITIES)[number], d: number;
  do { a = CITIES[Math.floor(rng.next() * CITIES.length)]; b = CITIES[Math.floor(rng.next() * CITIES.length)]; d = haversineKm(a[1], a[2], b[1], b[2]); }
  while (a === b || d < 120 || d > 480);
  const fleet = FLEET[Math.floor(rng.next() * FLEET.length)];
  const model = VEHICLE_CATALOG.find((v) => v.id === fleet.id)!;
  const driver: DriverProfile = DRIVER_PROFILES[Math.floor(rng.next() * DRIVER_PROFILES.length)];
  const month = Math.floor(rng.next() * 12);
  const tempC = MONTH_TEMP[month] + rng.gauss() * 3;
  const headWindMs = rng.gauss() * 2.5;
  const truthVehicle: VehicleParams = withStateOfHealth(model.params, fleet.soh);
  const knownVehicle = truthVehicle;                       // користувач EVPredict вказав SoH

  // світ ua: справжній вітер – вектор із компонентами N(0; 2,5) м/с, прогноз – з похибкою N(0; 1) м/с на компоненту;
  // окремий генератор, щоб поїздки (міста, автомобілі, водії, температура) збігалися з базовим світом
  const wRng = createRng(SEED * 17 + 3000 + trip);
  const vec = (x: number, y: number): Wind => ({ speedMs: Math.hypot(x, y), fromDeg: ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 });
  const [wx, wy] = [wRng.gauss() * 2.5, wRng.gauss() * 2.5];
  const trueWind = vec(wx, wy), forecastWind = vec(wx + wRng.gauss(), wy + wRng.gauss());
  const elevA = UA ? cityElev.get(a[0]) ?? 0 : 0, elevB = UA ? cityElev.get(b[0]) ?? 0 : 0;

  const { graph, nodes } = buildCorridorGraph({ id: "A", lat: a[1], lon: a[2], elevM: elevA }, { id: "B", lat: b[1], lon: b[2], elevM: elevB }, stations, {
    // в експерименті коридор фіксований (30 км), а ребра обмежено 450 км – запасом ходу автомобілів парку
    corridorKm: 30, circuity: CIRCUITY, maxEdgeKm: 450, highwayKmh: V_HW, connectors: model.connectors as Connector[],
    vehicleMaxDcKw: model.maxDcKw, now: NOW });
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // персоналізація EVPredict: 30 попередніх поїздок цього водія
  const history = generateTrips(truthVehicle, driver, { count: 30, seed: SEED * 31 + 1000 + trip });
  const replay = replayHistory(knownVehicle, history);
  const k = replay.personalFactor;
  const safety = safetyFromHistory(k, replay.ratios);
  const forecastTemp = tempC + rng.gauss() * 1.5;          // похибка прогнозу погоди

  // базова модель: «паспортне» споживання за фіксованих швидкості і температури, паспортна ємність (без SoH)
  const rated = segmentEnergyWh(model.params, { lengthM: 1000, speedMs: num("baselineSpeed") / 3.6, gradePct: 0, tempC: num("baselineTemp") }).energyWh;

  const kRoad = replay.roadFactors;
  // conditions = true: планувальник знає прогноз вітру (для кожного ребра за його азимутом) і висоти вузлів
  const physicsEdge = (k_: number | "road", conditions = false) => (e: { from: string; to: string; lengthKm: number; speedKmh: number }) => {
    const u = nodeMap.get(e.from)!, v = nodeMap.get(e.to)!;
    const dh = conditions ? v.elevM - u.elevM : 0;
    return (segmentEnergyWh(knownVehicle, { lengthM: e.lengthKm * 1000, speedMs: e.speedKmh / 3.6, gradePct: 0, tempC: forecastTemp,
      headWindMs: conditions ? headWindComponent(forecastWind, bearingDeg(u, v)) : undefined,
      stopsPerKm: e.lengthKm > HW_KM ? num("edgeStopsHighway") : num("edgeStopsCity") }).energyWh
      + (conditions ? reliefEnergyWh(knownVehicle, Math.max(dh, 0), Math.max(-dh, 0)) : 0))
      * (k_ === "road" ? (e.lengthKm > HW_KM ? kRoad.highway : kRoad.city) : k_);
  };
  // якщо з повним запасом план не знайдено — повторна спроба без запасу (такий план позначається як ризикований)
  const withFallback = (o: Parameters<typeof plan>[4], src = "A") => {
    const r = plan(graph, src, "B", knownVehicle, o);
    if (r.label) return { ...labelToPlan(r.label, r.expanded)!, risky: false };
    const r2 = plan(graph, src, "B", knownVehicle, { ...o, safetyFactor: 1, minReliability: 0, stationArrivalReserve: 0, chargeTargets: [...o.chargeTargets, 1.0] });
    return r2.label ? { ...labelToPlan(r2.label, r2.expanded)!, risky: true } : null;
  };
  const common = { tempC: forecastTemp, socStart: SOC_START, socMin: RESERVE, socArriveMin: RESERVE,
    chargeTargets: list("chargeTargets"), useHeuristic: true, vMaxKmh: num("heuristicSpeed") };
  const options: Record<Exclude<PlannerId, "baseline" | "naive">, Parameters<typeof plan>[4]> = {
    physics: { ...common, personalFactor: 1, edgeEnergy: physicsEdge(1) },
    personal: { ...common, personalFactor: k, edgeEnergy: physicsEdge("road"), safetyFactor: safety },
    full: { ...common, personalFactor: k, edgeEnergy: physicsEdge("road"), safetyFactor: safety, minReliability: num("minReliability"), failurePenaltyH: TF,
      stationArrivalReserve: num("stationArrivalReserve") },
    weather: { ...common, personalFactor: k, edgeEnergy: physicsEdge("road", true), safetyFactor: safety, minReliability: num("minReliability"), failurePenaltyH: TF,
      stationArrivalReserve: num("stationArrivalReserve") },
  };
  const baselineOpts = { whPerKm: rated, socStart: SOC_START, socMin: RESERVE, chargeTo: num("baselineChargeTo") };
  // наївний варіант без енергетичних обмежень: найшвидший шлях A → B без зарядних зупинок
  const directKm = d * CIRCUITY;
  const naiveGraph = buildGraph([nodes[0], nodes[1]], [{ from: "A", to: "B", lengthKm: directKm, speedKmh: V_HW }], true);
  const plans: Record<PlannerId, (TripPlan & { risky?: boolean }) | null> = {
    naive: { steps: [{ node: "A" }, { node: "B" }], plannedTimeH: directKm / V_HW, plannedArriveSoc: SOC_START - (directKm * rated) / (model.params.usableKWh * 1000), expanded: 0 },
    baseline: planBaseline(graph, "A", "B", model.params, baselineOpts),
    physics: withFallback(options.physics), personal: withFallback(options.personal), full: withFallback(options.full),
    weather: UA ? withFallback(options.weather) : null,
  };
  // перепланування: якщо станція не працює — усі планувальники; за відхиленням SoC — лише повна версія EVPredict
  const adaptFor = (id: PlannerId): Adaptation | undefined => id === "naive" ? undefined : id === "baseline"
    ? { replan: (from, soc, exclude) => planBaseline(graph, from, "B", model.params, { ...baselineOpts, socStart: soc, exclude }) }
    : { replan: (from, soc, exclude) => withFallback({ ...options[id], socStart: soc, exclude }, from),
        deviation: id === "full" || id === "weather" ? num("replanDeviation") : undefined };

  for (const scenario of ["informative", "random"] as const) {
    // справжній стан станцій на цю поїздку (однаковий для всіх планувальників)
    const sRng = createRng(SEED * 7 + 5000 + trip * 2 + (scenario === "random" ? 1 : 0));
    const works = new Map<string, boolean>();
    for (const n of nodes) if (n.chargerKW) {
      const p = scenario === "informative" ? Math.min(0.98, (n.reliability ?? 0.8) * 0.95) : 0.8;
      works.set(n.id, sRng.next() < p);
    }
    for (const id of PLANNERS) {
      const pl = plans[id];
      const nRng = createRng(SEED * 13 + 9000 + trip);                // однаковий шум для всіх планувальників
      if (!pl) { rows.push({ trip, scenario, planner: id, planFound: false }); continue; }
      const res = executePlan(pl, id === "naive" ? naiveGraph : graph, nodeMap, {
        vehicle: truthVehicle, driver, tempC, headWindMs, circuity: CIRCUITY, ...(UA ? { wind: trueWind, relief: true } : {}),
        edgeNoise: () => (1 + BIAS) * (1 + 0.04 * nRng.gauss()), stationWorks: (nid) => works.get(nid) ?? false,
      }, SOC_START, RESERVE, adaptFor(id));
      rows.push({ trip, scenario, planner: id, planFound: true, from: a[0], to: b[0], km: d * CIRCUITY, vehicle: model.id, driver: driver.id,
        tempC: +tempC.toFixed(1), stations: nodes.length - 2, k: +k.toFixed(3), safety: +safety.toFixed(3),
        risky: pl.risky ?? false, kHighway: +kRoad.highway.toFixed(3), plannedStops: pl.steps.filter((s) => s.chargeTo !== undefined).length, plannedTimeH: pl.plannedTimeH, plannedArriveSoc: pl.plannedArriveSoc,
        expanded: pl.expanded, ...res, arrivalErrorPp: res.completed ? (res.arriveSoc - pl.plannedArriveSoc) * 100 : null });
    }
  }
}

// каталог результатів можна змінити змінною OUT (для пробних запусків, щоб не перезаписати результати експерименту)
const OUT = process.env.OUT ?? `${here}results`;
mkdirSync(OUT, { recursive: true });
const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
writeFileSync(`${OUT}/trips_${TAG}seed${SEED}.csv`, [keys.join(","), ...rows.map((r) => keys.map((k) => r[k] ?? "").join(","))].join("\n"));

// зведення
const summary: Record<string, unknown>[] = [];
for (const scenario of ["informative", "random"]) for (const planner of PLANNERS) {
  const rs = rows.filter((r) => r.scenario === scenario && r.planner === planner);
  const found = rs.filter((r) => r.planFound);
  const ok = found.filter((r) => r.completed);
  const both = rows.filter((r) => r.scenario === scenario && r.planner === "baseline" && r.completed).map((r) => r.trip);
  const common = ok.filter((r) => both.includes(r.trip as number) && rows.some((x) => x.scenario === scenario && x.trip === r.trip && x.planner === "full" && x.completed));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);
  summary.push({ scenario, planner, trips: rs.length,
    planFoundPct: (100 * found.length) / rs.length,
    riskyPlanPct: (100 * found.filter((r) => r.risky).length) / rs.length,
    strandedPct: (100 * found.filter((r) => !r.completed).length) / Math.max(found.length, 1),
    belowReservePct: (100 * found.filter((r) => r.belowReserve).length) / Math.max(found.length, 1),
    successPct: (100 * ok.length) / rs.length,
    meanTimeH_common: mean(common.map((r) => r.timeH as number)),
    meanAbsArrivalErrPp: mean(ok.map((r) => Math.abs(r.arrivalErrorPp as number))),
    meanStops: mean(found.map((r) => r.chargeStops as number)),
    failedStationsPerTrip: mean(found.map((r) => r.failedStations as number)),
    replansPerTrip: mean(found.map((r) => r.replans as number)) });
}
writeFileSync(`${OUT}/summary_${TAG}seed${SEED}.json`, JSON.stringify(summary, null, 2));
console.table(summary.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v]))));
