// Експеримент 2: рекомендація маршруту і заряджань — EVPredict проти базового планувальника на Дейкстрі.
// Реальні станції України (Open Charge Map), реальні міста, кліматичні температури Києва,
// прихований стиль водіння і станції, що можуть не працювати.
// Світ WORLD=ua додає до «справжнього» світу рельєф (висоти міст і станцій з Copernicus DEM) і вітер з напрямком,
// а до порівняння – варіант EVPredict, який знає прогноз вітру (з похибкою) і висоти вузлів.
// Запуск: node --experimental-strip-types research/benchmark/run.ts [кількість поїздок] [seed] [bias]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  type StationRecord, type DriverProfile, type TripPlan, type VehicleParams, type Connector, type Graph, type CorridorNode,
  DRIVER_PROFILES, VEHICLE_CATALOG, buildCorridorGraph, buildGraph, createRng, executePlan, generateTrips, haversineKm,
  type Adaptation, labelToPlan, safetyFromHistory, plan, planBaseline, replayHistory, segmentEnergyWh, withStateOfHealth, num, list,
  UA_CITIES, type Wind, bearingDeg, headWindComponent, reliefEnergyWh, reliabilityScore, withDefaultParams,
} from "../../lib/energy/src/index.ts";
import { diverseStations } from "../sensitivity/diverse.ts";

const N = Number(process.argv[2] ?? 400);
const SEED = Number(process.argv[3] ?? 2026);
// стресовий сценарій: фактичне споживання систематично вище за будь-який прогноз (частка, напр. 0,15)
const BIAS = Number(process.argv[4] ?? 0);
// параметр штрафу за ненадійність станції T_f, год (аналіз чутливості)
const TF = Number(process.env.TF ?? num("failurePenaltyH"));
// світ з рельєфом і вітром із напрямком
const UA = process.env.WORLD === "ua";
// коридор пошуку станцій: як у застосунку (30 → 60 → 100 км, доки не знайдено план із запасом) або фіксований
// перший крок (CORRIDOR=fixed, контрольний експеримент); політика однакова для всіх планувальників
const FIXED = process.env.CORRIDOR === "fixed";
const WIDTHS = FIXED ? [list("corridorStepsKm")[0]] : list("corridorStepsKm");
const TAG = (FIXED ? "fixed_" : "") + (UA ? "ua_" : "") + (BIAS ? `bias${Math.round(BIAS * 100)}_` : "") + (process.env.TF ? `tf${Math.round(TF * 100)}_` : "");
const here = new URL(".", import.meta.url).pathname;
const NOW = new Date("2026-10-01T00:00:00Z");
const snapshot: StationRecord[] = JSON.parse(readFileSync(`${here}../stations/data/ua_stations.json`, "utf8"));
// STATIONS=diverse – стресовий реєстр для аналізу чутливості (research/sensitivity/diverse.ts)
const stations = process.env.STATIONS === "diverse" ? diverseStations(snapshot, NOW) : snapshot;
const stationById = new Map(stations.map((s) => [`s${s.id}`, s]));

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

  const placeA = { id: "A", lat: a[1], lon: a[2], elevM: elevA }, placeB = { id: "B", lat: b[1], lon: b[2], elevM: elevB };
  type Corridor = { km: number; graph: Graph; nodes: CorridorNode[]; nodeMap: Map<string, CorridorNode> };
  const corridors = new Map<number, Corridor>();
  const corridor = (km: number): Corridor => {
    if (!corridors.has(km)) {
      // ребра обмежено 450 км – запасом ходу автомобілів парку
      const { graph, nodes } = buildCorridorGraph(placeA, placeB, stations, { corridorKm: km, circuity: CIRCUITY, maxEdgeKm: 450,
        highwayKmh: V_HW, connectors: model.connectors as Connector[], vehicleMaxDcKw: model.maxDcKw, now: NOW });
      corridors.set(km, { km, graph, nodes, nodeMap: new Map(nodes.map((n) => [n.id, n])) });
    }
    return corridors.get(km)!;
  };

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
  const physicsEdge = (nodeMap: Map<string, CorridorNode>, k_: number | "road", conditions = false) =>
    (e: { from: string; to: string; lengthKm: number; speedKmh: number }) => {
      const u = nodeMap.get(e.from)!, v = nodeMap.get(e.to)!;
      const dh = conditions ? v.elevM - u.elevM : 0;
      return (segmentEnergyWh(knownVehicle, { lengthM: e.lengthKm * 1000, speedMs: e.speedKmh / 3.6, gradePct: 0, tempC: forecastTemp,
        headWindMs: conditions ? headWindComponent(forecastWind, bearingDeg(u, v)) : undefined,
        stopsPerKm: e.lengthKm > HW_KM ? num("edgeStopsHighway") : num("edgeStopsCity") }).energyWh
        + (conditions ? reliefEnergyWh(knownVehicle, Math.max(dh, 0), Math.max(-dh, 0)) : 0))
        * (k_ === "road" ? (e.lengthKm > HW_KM ? kRoad.highway : kRoad.city) : k_);
    };
  const common = { tempC: forecastTemp, socStart: SOC_START, socMin: RESERVE, socArriveMin: RESERVE,
    chargeTargets: list("chargeTargets"), useHeuristic: true, vMaxKmh: num("heuristicSpeed") };
  type EvId = Exclude<PlannerId, "baseline" | "naive">;
  const optionsFor = (id: EvId, c: Corridor): Parameters<typeof plan>[4] => ({
    physics: { ...common, personalFactor: 1, edgeEnergy: physicsEdge(c.nodeMap, 1) },
    personal: { ...common, personalFactor: k, edgeEnergy: physicsEdge(c.nodeMap, "road"), safetyFactor: safety },
    full: { ...common, personalFactor: k, edgeEnergy: physicsEdge(c.nodeMap, "road"), safetyFactor: safety, minReliability: num("minReliability"),
      failurePenaltyH: TF, stationArrivalReserve: num("stationArrivalReserve") },
    weather: { ...common, personalFactor: k, edgeEnergy: physicsEdge(c.nodeMap, "road", true), safetyFactor: safety, minReliability: num("minReliability"),
      failurePenaltyH: TF, stationArrivalReserve: num("stationArrivalReserve") },
  })[id];
  // план без запасу (ризикований) шукається лише в найширшому коридорі, як у застосунку
  const fallback = (c: Corridor, o: Parameters<typeof plan>[4], src: string) => {
    const r2 = plan(c.graph, src, "B", knownVehicle, { ...o, safetyFactor: 1, minReliability: 0, stationArrivalReserve: 0, chargeTargets: [...o.chargeTargets, 1.0] });
    return r2.label ? { ...labelToPlan(r2.label, r2.expanded)!, risky: true } : null;
  };
  const withFallback = (c: Corridor, o: Parameters<typeof plan>[4], src = "A") => {
    const r = plan(c.graph, src, "B", knownVehicle, o);
    return r.label ? { ...labelToPlan(r.label, r.expanded)!, risky: false } : fallback(c, o, src);
  };
  const baselineOpts = { whPerKm: rated, socStart: SOC_START, socMin: RESERVE, chargeTo: num("baselineChargeTo") };
  type Chosen = { pl: (TripPlan & { risky?: boolean }) | null; c: Corridor; ms: number };
  // однакова політика коридору для всіх планувальників: найвужчий коридор, у якому знайдено план
  const choose = (id: PlannerId): Chosen => {
    const t0 = performance.now();
    let last: Chosen | null = null;
    for (const [i, km] of WIDTHS.entries()) {
      const c = corridor(km);
      if (id === "baseline") {
        const pl = planBaseline(c.graph, "A", "B", model.params, baselineOpts);
        last = { pl, c, ms: 0 };
        if (pl) break;
      } else if (id !== "naive") {
        const o = optionsFor(id, c), r = plan(c.graph, "A", "B", knownVehicle, o);
        if (r.label) { last = { pl: { ...labelToPlan(r.label, r.expanded)!, risky: false }, c, ms: 0 }; break; }
        last = { pl: i === WIDTHS.length - 1 ? fallback(c, o, "A") : null, c, ms: 0 };
      }
    }
    return { ...last!, ms: performance.now() - t0 };
  };
  // наївний варіант без енергетичних обмежень: найшвидший шлях A → B без зарядних зупинок
  const directKm = d * CIRCUITY;
  const first = corridor(WIDTHS[0]);
  const naiveGraph = buildGraph([first.nodes[0], first.nodes[1]], [{ from: "A", to: "B", lengthKm: directKm, speedKmh: V_HW }], true);
  const chosen = {} as Record<PlannerId, Chosen>;
  for (const id of PLANNERS) chosen[id] = id === "naive"
    ? { pl: { steps: [{ node: "A" }, { node: "B" }], plannedTimeH: directKm / V_HW, plannedArriveSoc: SOC_START - (directKm * rated) / (model.params.usableKWh * 1000), expanded: 0 }, c: first, ms: 0 }
    : choose(id);
  // перепланування в тому самому коридорі: якщо станція не працює — усі планувальники; за відхиленням SoC — лише повна версія EVPredict
  const adaptFor = (id: PlannerId): Adaptation | undefined => {
    const c = chosen[id].c;
    return id === "naive" ? undefined : id === "baseline"
      ? { replan: (from, soc, exclude) => planBaseline(c.graph, from, "B", model.params, { ...baselineOpts, socStart: soc, exclude }) }
      : { replan: (from, soc, exclude) => withFallback(c, { ...optionsFor(id, c), socStart: soc, exclude }, from),
          deviation: id === "full" || id === "weather" ? num("replanDeviation") : undefined };
  };

  for (const scenario of ["informative", "random"] as const) {
    // справжній стан станцій на цю поїздку: однаковий для всіх планувальників і всіх ширин коридору (окремий
    // генератор для кожної станції); імовірність роботи – з індексу за параметрами реєстру за замовчуванням,
    // тож аналіз чутливості (PARAM_OVERRIDES) змінює лише знання планувальника, а не сам світ
    const worksCache = new Map<string, boolean>();
    const stationWorks = (nid: string) => {
      if (!worksCache.has(nid)) {
        const st = stationById.get(nid);
        if (!st) { worksCache.set(nid, false); return false; }
        const r = createRng(((SEED * 7 + 5000 + trip * 2 + (scenario === "random" ? 1 : 0)) ^ Math.imul(st.id, 0x9e3779b1)) >>> 0);
        const rel = withDefaultParams(() => reliabilityScore(st, NOW).score);
        worksCache.set(nid, r.next() < (scenario === "informative" ? Math.min(0.98, rel * 0.95) : 0.8));
      }
      return worksCache.get(nid)!;
    };
    for (const id of PLANNERS) {
      const { pl, c, ms } = chosen[id];
      const nRng = createRng(SEED * 13 + 9000 + trip);                // однаковий шум для всіх планувальників
      if (!pl) { rows.push({ trip, scenario, planner: id, planFound: false, corridorKm: null, planMs: ms }); continue; }
      const res = executePlan(pl, id === "naive" ? naiveGraph : c.graph, c.nodeMap, {
        vehicle: truthVehicle, driver, tempC, headWindMs, circuity: CIRCUITY, ...(UA ? { wind: trueWind, relief: true } : {}),
        edgeNoise: () => (1 + BIAS) * (1 + 0.04 * nRng.gauss()), stationWorks,
      }, SOC_START, RESERVE, adaptFor(id));
      rows.push({ trip, scenario, planner: id, planFound: true, from: a[0], to: b[0], km: d * CIRCUITY, vehicle: model.id, driver: driver.id,
        tempC: +tempC.toFixed(1), stations: c.nodes.length - 2, corridorKm: id === "naive" ? null : c.km, planMs: +ms.toFixed(2),
        k: +k.toFixed(3), safety: +safety.toFixed(3),
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
    replansPerTrip: mean(found.map((r) => r.replans as number)),
    // ширина коридору, в якому знайдено план, і час пошуку (без побудови графа – однаковий для всіх)
    ...Object.fromEntries(WIDTHS.map((w) => [`foundAt${w}kmPct`, (100 * found.filter((r) => r.corridorKm === w).length) / rs.length])),
    noPlanPct: (100 * (rs.length - found.length)) / rs.length,
    meanPlanMs: mean(rs.map((r) => (r.planMs as number) ?? 0)) });
}
writeFileSync(`${OUT}/summary_${TAG}seed${SEED}.json`, JSON.stringify(summary, null, 2));
console.table(summary.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v]))));
