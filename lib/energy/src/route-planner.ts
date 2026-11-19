// Рекомендація маршруту і зарядних зупинок між містами: EVPredict і базовий планувальник для порівняння
import type { VehicleParams } from "./physics.ts";
import { segmentEnergyWh } from "./physics.ts";
import { reliefEnergyWh } from "./trip.ts";
import type { Connector } from "./vehicles.ts";
import type { RoadType } from "./trip.ts";
import { type CorridorNode, type StationRecord, type Wind, bearingDeg, buildCorridorGraph, haversineKm, headWindComponent } from "./stations.ts";
import { type TripPlan, labelToPlan, plan, planBaseline, chargeTimeH } from "./routing.ts";
import { DEFAULT_SAFETY } from "./forecast.ts";
import { num, list } from "./params.ts";

export interface RoutePlanRequest {
  from: { id: string; lat: number; lon: number; elevM?: number };
  to: { id: string; lat: number; lon: number; elevM?: number };
  vehicle: VehicleParams;           // з урахуванням SoH
  ratedVehicle: VehicleParams;      // паспортні параметри (для базової моделі)
  connectors: Connector[];
  maxDcKw: number;
  maxAcKw?: number;                 // бортовий зарядний пристрій, для власних AC-точок
  socStartPct: number;
  reservePct: number;
  tempC: number;
  headWindMs?: number;              // стала складова вітру назустріч руху для всіх ділянок, м/с (від'ємна – попутний)
  wind?: Wind;                      // вітер за прогнозом: складова назустріч рахується для кожної ділянки за її азимутом
  personalFactor: number;
  roadFactors?: Record<RoadType, number>;
  safetyFactor?: number;
  stations: StationRecord[];
  now?: Date;
}

export interface RouteStop {
  nodeId: string;
  kind: "origin" | "station" | "destination";
  title: string;
  town: string;
  lat: number;
  lon: number;
  maxKw?: number;
  own?: boolean;                     // власна точка заряду користувача
  ac?: boolean;
  reliabilityPct?: number;
  socArrivePct: number;
  chargeToPct?: number;
  chargeMinutes?: number;
  kmFromStart: number;
}

export interface RouteOption {
  found: boolean;
  risky: boolean;                    // план знайдено лише без запасу на невизначеність
  stops: RouteStop[];
  km: number;
  driveMinutes: number;
  chargeMinutes: number;
  totalMinutes: number;
  arriveSocPct: number;
  minSocPct: number;
  energyKWh: number;
  climbM: number;                    // сумарний набір висоти між вузлами плану, м
  descentM: number;
}

export interface RoutePlanResult {
  evpredict: RouteOption;
  baseline: RouteOption;
  stationsInCorridor: number;
  corridorKm: number;
  corridorStations: { lat: number; lon: number; reliabilityPct: number; maxKw: number; own?: boolean }[];
}

const CIRCUITY = num("circuity");

/** Ширина коридору пошуку станцій розширюється, якщо у відкритих даних є прогалини */
export const CORRIDOR_STEPS_KM = list("corridorStepsKm");

export function planRoute(req: RoutePlanRequest): RoutePlanResult {
  let last: RoutePlanResult | undefined;
  // план без запасу (ризикований) шукається лише в найширшому коридорі: результат той самий,
  // а повторний пошук без обмежень у вужчих коридорах лише витрачав би час
  for (const [i, corridorKm] of CORRIDOR_STEPS_KM.entries()) {
    last = planInCorridor(req, corridorKm, i === CORRIDOR_STEPS_KM.length - 1);
    if (last.evpredict.found && !last.evpredict.risky) return last;
  }
  return last!;
}

function planInCorridor(req: RoutePlanRequest, corridorKm: number, allowFallback = true): RoutePlanResult {
  // ребро, довше за запас ходу навіть в ідеальних умовах, ніколи не буде використане — не будуємо його
  const ideal = { lengthM: 1000, speedMs: num("edgeSpeedCity") / 3.6, gradePct: 0, tempC: num("baselineTemp") };
  const bestWhKm = Math.min(segmentEnergyWh(req.vehicle, ideal).energyWh, segmentEnergyWh(req.ratedVehicle, ideal).energyWh) * num("edgePruneFactor");
  const maxEdgeKm = Math.min(num("maxEdgeKm"), (req.ratedVehicle.usableKWh * 1000) / bestWhKm);
  const { graph, nodes } = buildCorridorGraph(req.from, req.to, req.stations, {
    corridorKm, circuity: CIRCUITY, maxEdgeKm, highwayKmh: num("edgeSpeedHighway"), connectors: req.connectors, vehicleMaxDcKw: req.maxDcKw, vehicleMaxAcKw: req.maxAcKw, now: req.now });
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const k = req.personalFactor;
  const kr = req.roadFactors ?? { city: k, suburban: k, highway: k };
  const hwKm = num("highwayEdgeMinKm");
  // рельєф ураховується різницею висот кінців ребра (набір – через ККД приводу, спуск – з рекуперацією);
  // без даних про висоти всі вузли мають висоту 0 і внесок рельєфу нульовий
  const dh = (e: { from: string; to: string }) => (nodeMap.get(e.to)?.elevM ?? 0) - (nodeMap.get(e.from)?.elevM ?? 0);
  const hw = (e: { from: string; to: string }) => req.wind
    ? headWindComponent(req.wind, bearingDeg(nodeMap.get(e.from)!, nodeMap.get(e.to)!)) : req.headWindMs;
  const edgeWh = (p: VehicleParams, kk: (km: number) => number, temp: number) => (e: { from: string; to: string; lengthKm: number; speedKmh: number }) =>
    (segmentEnergyWh(p, { lengthM: e.lengthKm * 1000, speedMs: e.speedKmh / 3.6, gradePct: 0, tempC: temp, headWindMs: hw(e),
      stopsPerKm: e.lengthKm > hwKm ? num("edgeStopsHighway") : num("edgeStopsCity") }).energyWh + reliefEnergyWh(p, Math.max(dh(e), 0), Math.max(-dh(e), 0))) * kk(e.lengthKm);
  const ours = edgeWh(req.vehicle, (km) => (km > hwKm ? kr.highway : kr.city), req.tempC);
  const opts = { tempC: req.tempC, socStart: req.socStartPct / 100, socMin: req.reservePct / 100, socArriveMin: req.reservePct / 100,
    chargeTargets: list("chargeTargets"), personalFactor: k, useHeuristic: true, vMaxKmh: num("heuristicSpeed"), edgeEnergy: ours,
    safetyFactor: req.safetyFactor ?? DEFAULT_SAFETY, minReliability: num("minReliability"), failurePenaltyH: num("failurePenaltyH"),
    stationArrivalReserve: num("stationArrivalReserve"), socTolerance: num("socTolerance") };
  let risky = false;
  let r = plan(graph, req.from.id, req.to.id, req.vehicle, opts);
  if (!r.label && allowFallback) {
    risky = true;
    r = plan(graph, req.from.id, req.to.id, req.vehicle, { ...opts, safetyFactor: 1, minReliability: 0, stationArrivalReserve: 0, chargeTargets: [...opts.chargeTargets, 1] });
  }
  const oursPlan = labelToPlan(r.label, r.expanded);
  // базова модель: паспортне споживання за фіксованих швидкості і температури, паспортна ємність
  const rated = segmentEnergyWh(req.ratedVehicle, { lengthM: 1000, speedMs: num("baselineSpeed") / 3.6, gradePct: 0, tempC: num("baselineTemp") }).energyWh;
  const basePlan = planBaseline(graph, req.from.id, req.to.id, req.ratedVehicle,
    { whPerKm: rated, socStart: req.socStartPct / 100, socMin: req.reservePct / 100, chargeTo: num("baselineChargeTo") });

  // обидва плани оцінюються однією («нашою») моделлю споживання, щоб показати очікуваний результат
  const describe = (pl: TripPlan | null, isRisky: boolean): RouteOption => {
    if (!pl) return { found: false, risky: false, stops: [], km: 0, driveMinutes: 0, chargeMinutes: 0, totalMinutes: 0, arriveSocPct: 0, minSocPct: 0, energyKWh: 0, climbM: 0, descentM: 0 };
    const cap = req.vehicle.usableKWh * 1000;
    let soc = req.socStartPct / 100, km = 0, drive = 0, charge = 0, minSoc = soc, energy = 0, climb = 0, descent = 0;
    const stops: RouteStop[] = [];
    pl.steps.forEach((s, i) => {
      if (i > 0) {
        const e = graph.adj.get(pl.steps[i - 1].node)!.find((x) => x.to === s.node)!;
        const wh = ours(e); soc -= wh / cap; energy += wh; km += e.lengthKm; drive += (e.lengthKm / e.speedKmh) * 60;
        climb += Math.max(dh(e), 0); descent += Math.max(-dh(e), 0);
        minSoc = Math.min(minSoc, soc);
      }
      const n = nodeMap.get(s.node) as CorridorNode;
      const stop: RouteStop = { nodeId: s.node, kind: i === 0 ? "origin" : i === pl.steps.length - 1 ? "destination" : "station",
        title: n.station?.title ?? "", town: n.station?.town ?? "", lat: n.lat, lon: n.lon, maxKw: n.chargerKW,
        ...(n.station?.own ? { own: true } : {}), ...(n.ac ? { ac: true } : {}),
        reliabilityPct: n.reliability !== undefined ? n.reliability * 100 : undefined, socArrivePct: soc * 100, kmFromStart: km };
      if (s.chargeTo !== undefined && soc < s.chargeTo) {
        const m = chargeTimeH(req.vehicle, n.chargerKW!, Math.max(soc, 0), s.chargeTo, n.ac) * 60;
        stop.chargeToPct = s.chargeTo * 100; stop.chargeMinutes = m; charge += m; soc = s.chargeTo;
      }
      // станція, через яку маршрут лише проходить без заряджання, не є зупинкою
      if (stop.kind !== "station" || stop.chargeToPct !== undefined) stops.push(stop);
    });
    return { found: true, risky: isRisky, stops, km, driveMinutes: drive, chargeMinutes: charge, totalMinutes: drive + charge,
      arriveSocPct: soc * 100, minSocPct: minSoc * 100, energyKWh: energy / 1000, climbM: climb, descentM: descent };
  };
  return {
    evpredict: describe(oursPlan, risky),
    baseline: describe(basePlan, false),
    stationsInCorridor: nodes.length - 2,
    corridorKm,
    corridorStations: nodes.filter((n) => n.chargerKW).map((n) => ({ lat: n.lat, lon: n.lon, reliabilityPct: (n.reliability ?? 0) * 100, maxKw: n.chargerKW!, ...(n.station?.own ? { own: true } : {}) })),
  };
}

export const straightKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => haversineKm(a.lat, a.lon, b.lat, b.lon);
