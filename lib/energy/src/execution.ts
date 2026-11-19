// Симулятор виконання плану поїздки: «справжній» світ, якого планувальник не знає повністю.
// Справжнє споживання визначається прихованим стилем водія, погодою, вітром і випадковим шумом,
// а станції можуть не працювати. Використовується для порівняння планувальників.
import type { VehicleParams } from "./physics.ts";
import { segmentEnergyWh } from "./physics.ts";
import type { DriverProfile } from "./simulator.ts";
import { type Graph, type RouteEdge, type TripPlan, chargeTimeH } from "./routing.ts";
import { type CorridorNode, type Wind, bearingDeg, haversineKm, headWindComponent } from "./stations.ts";
import { reliefEnergyWh } from "./trip.ts";
import { num, withDefaultParams } from "./params.ts";

// «Справжній» світ симулятора бере дорожні параметри з реєстру за замовчуванням, щоб аналіз
// чутливості (PARAM_OVERRIDES) змінював лише знання планувальника, а не сам світ
const WORLD = withDefaultParams(() => ({ hwKm: num("highwayEdgeMinKm"), stopsHw: num("edgeStopsHighway"),
  stopsCity: num("edgeStopsCity"), cityKmh: num("edgeSpeedCity") }));

export interface WorldTruth {
  vehicle: VehicleParams;              // справжні параметри (з урахуванням фактичного SoH)
  driver: DriverProfile;               // прихований стиль водіння
  tempC: number;
  headWindMs: number;                  // стала складова вітру назустріч руху (якщо wind не задано)
  wind?: Wind;                         // вітер з напрямком: складова назустріч залежить від азимуту ділянки
  relief?: boolean;                    // ураховувати різницю висот вузлів (elevM)
  edgeNoise: () => number;             // множник шуму для ребра, ≈ 1 ± кілька відсотків
  stationWorks: (nodeId: string) => boolean;
  circuity: number;
}

export interface Adaptation {
  /** Перепланування з поточної вершини з поточним SoC без виключених станцій */
  replan: (from: string, soc: number, exclude: ReadonlySet<string>) => TripPlan | null;
  /** Перепланувати, якщо фактичний SoC нижчий за запланований більш ніж на стільки (частка 0..1) */
  deviation?: number;
  maxReplans?: number;
}

export interface ExecutionResult {
  completed: boolean;                  // дісталися пункту призначення без повного розряду
  belowReserve: boolean;               // SoC опускався нижче резерву
  minSoc: number;
  arriveSoc: number;
  timeH: number;
  chargeStops: number;
  failedStations: number;              // скільки разів запланована станція не працювала
  detours: number;
  replans: number;
}

export function trueEdgeWh(w: WorldTruth, e: Pick<RouteEdge, "lengthKm" | "speedKmh">,
  ends?: { from: { lat: number; lon: number; elevM: number }; to: { lat: number; lon: number; elevM: number } }) {
  const p = { ...w.vehicle, hvacWPerDeg: w.vehicle.hvacWPerDeg * w.driver.hvacFactor };
  const v = e.speedKmh * w.driver.speedFactor;
  const stops = (e.lengthKm > WORLD.hwKm ? WORLD.stopsHw : WORLD.stopsCity) * w.driver.stopsFactor;
  const headWindMs = w.wind && ends ? headWindComponent(w.wind, bearingDeg(ends.from, ends.to)) : w.headWindMs;
  const dh = w.relief && ends ? ends.to.elevM - ends.from.elevM : 0;
  return (segmentEnergyWh(p, { lengthM: e.lengthKm * 1000, speedMs: v / 3.6, gradePct: 0, tempC: w.tempC,
    headWindMs, stopsPerKm: stops }).energyWh + reliefEnergyWh(p, Math.max(dh, 0), Math.max(-dh, 0))) * w.edgeNoise();
}

export function executePlan(plan: TripPlan, g: Graph, nodes: Map<string, CorridorNode>, w: WorldTruth,
  socStart: number, socReserve: number, adapt?: Adaptation): ExecutionResult {
  const cap = w.vehicle.usableKWh * 1000;
  let soc = socStart, minSoc = socStart, timeH = 0, chargeStops = 0, failed = 0, detours = 0, replans = 0;
  const exclude = new Set<string>();
  let steps = plan.steps;
  const tryReplan = (from: string) => {
    if (!adapt || replans >= (adapt.maxReplans ?? num("maxReplans"))) return false;
    const np = adapt.replan(from, soc, exclude);
    if (!np) return false;
    replans++; steps = np.steps; return true;
  };
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    // адаптивність: фактичний заряд суттєво нижчий за запланований — перебудувати план
    if (i > 0 && adapt?.deviation !== undefined && step.socArrive !== undefined && i < steps.length - 1
      && soc < step.socArrive - adapt.deviation && tryReplan(step.node)) { i = -1; continue; }
    if (step.chargeTo !== undefined && soc < step.chargeTo) {
      const here = nodes.get(step.node)!;
      if (w.stationWorks(step.node)) {
        timeH += chargeTimeH(w.vehicle, here.chargerKW!, Math.max(soc, 0), step.chargeTo, here.ac);
        soc = step.chargeTo; chargeStops++;
      } else {
        failed++;
        exclude.add(step.node);
        timeH += 10 / 60; // час на спробу і з'ясування
        if (tryReplan(step.node)) { i = -1; continue; }
        // без перепланування водій шукає найближчу іншу робочу станцію в радіусі 20 км
        const alt = [...nodes.values()]
          .filter((n) => n.chargerKW && n.id !== here.id && w.stationWorks(n.id))
          .map((n) => ({ n, km: haversineKm(here.lat, here.lon, n.lat, n.lon) * w.circuity }))
          .filter((x) => x.km <= 20)
          .sort((a, b) => a.km - b.km)[0];
        if (alt) {
          const leg = { lengthKm: alt.km, speedKmh: WORLD.cityKmh };
          const legEnds = { from: here, to: alt.n };
          const there = soc - trueEdgeWh(w, leg, legEnds) / cap;
          if (there >= 0) {
            detours++;
            timeH += (2 * alt.km) / WORLD.cityKmh + chargeTimeH(w.vehicle, alt.n.chargerKW!, there, step.chargeTo, alt.n.ac);
            soc = step.chargeTo - trueEdgeWh(w, leg, { from: alt.n, to: here }) / cap; chargeStops++;
            minSoc = Math.min(minSoc, there);
          }
        }
      }
    }
    if (i === steps.length - 1) break;
    const e = g.adj.get(step.node)!.find((x) => x.to === steps[i + 1].node)!;
    soc -= trueEdgeWh(w, e, { from: nodes.get(e.from)!, to: nodes.get(e.to)! }) / cap;
    timeH += e.lengthKm / (e.speedKmh * w.driver.speedFactor);
    minSoc = Math.min(minSoc, soc);
    if (soc < 0) {
      return { completed: false, belowReserve: true, minSoc: soc, arriveSoc: soc, timeH, chargeStops, failedStations: failed, detours, replans };
    }
  }
  return { completed: true, belowReserve: minSoc < socReserve, minSoc, arriveSoc: soc, timeH, chargeStops, failedStations: failed, detours, replans };
}
