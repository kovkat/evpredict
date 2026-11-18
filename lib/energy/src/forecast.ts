// Ключова функція: персональний прогноз поїздки з поясненням і режимом «що буде, якщо»
import type { VehicleParams } from "./physics.ts";
import { type TripInput, tripKm, tripMinutes } from "./trip.ts";
import { type Factor, FACTORS, explainShapley, explanationText, factorName, energyWithFactors } from "./explain.ts";
import { num, list } from "./params.ts";

export interface ForecastRequest {
  vehicle: VehicleParams;
  trip: TripInput;
  personalFactor?: number;        // k_u, за замовчуванням 1
  historyRatios?: number[];       // відношення факт / прогноз без персоналізації за історією
  socStartPct: number;
  socArriveMinPct?: number;       // мінімально допустимий SoC при прибутті, за замовчуванням 10 %
  lang?: "uk" | "en";
}

export interface WhatIf {
  id: string;
  label: string;
  energyKWh: number;
  deltaKWh: number;
  deltaMinutes: number;
  socArrivePct: number;
}

export interface Forecast {
  km: number;
  minutes: number;
  energyKWh: number;
  energyLowKWh: number;
  energyHighKWh: number;
  whPerKm: number;
  socStartPct: number;
  socUsedPct: number;
  socArrivePct: number;
  socArriveWorstPct: number;      // за верхньою межею інтервалу
  socArriveMinPct: number;
  status: "ok" | "tight" | "insufficient";
  personalFactor: number;
  historyTrips: number;
  baseKWh: number;
  contributions: { factor: Factor; label: string; kWh: number; socPct: number }[];
  explanation: string[];
  whatIf: WhatIf[];
}

const pct = (x: number) => Math.round(x * 100);

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/** Відносний інтервал прогнозу: за історією користувача (не менше J_min поїздок) або типовий */
export function predictionInterval(k: number, ratios: number[] = []): [number, number] {
  if (ratios.length < num("intervalMinTrips")) { const [a, b] = list("defaultInterval"); return [a, b]; }
  const rel = ratios.map((r) => r / k);
  const [qLo, qHi] = list("intervalQuantiles"), [wLo, wHi] = list("intervalMinWidth");
  return [Math.min(quantile(rel, qLo), wLo), Math.max(quantile(rel, qHi), wHi)];
}

/** Запас на невизначеність прогнозу для планування маршруту: квантиль q_σ відношень «факт / прогноз»,
 *  нормованих на k, у межах [σ_min; σ_max]. За браком історії (менше J_σ надійних поїздок) – типовий запас σ_0. */
export const DEFAULT_SAFETY = num("safetyDefault");
export function safetyFromHistory(k: number, ratios: number[] = []): number {
  if (ratios.length < num("safetyMinTrips")) return DEFAULT_SAFETY;
  const [lo, hi] = list("safetyClip");
  return Math.min(hi, Math.max(lo, quantile(ratios.map((r) => r / k), num("safetyQuantile"))));
}

export function forecastTrip(req: ForecastRequest): Forecast {
  const k = req.personalFactor ?? 1;
  const lang = req.lang ?? "en";
  const p = req.vehicle, t = req.trip;
  const minArrive = req.socArriveMinPct ?? num("arriveReserveDefaultPct");
  const ex = explainShapley(p, t, k);
  const [lo, hi] = predictionInterval(k, req.historyRatios);
  const cap = p.usableKWh * 1000;
  const socUsed = (ex.predWh / cap) * 100;
  const socArrive = req.socStartPct - socUsed;
  const socWorst = req.socStartPct - (ex.predWh * hi / cap) * 100;
  const km = tripKm(t), minutes = tripMinutes(t);
  const status = socArrive < minArrive ? "insufficient" : socWorst < minArrive ? "tight" : "ok";

  const scenario = (id: string, label: string, trip: TripInput, params: VehicleParams = p): WhatIf => {
    const e = energyWithFactors(params, trip, new Set(FACTORS), k);
    return { id, label, energyKWh: e / 1000, deltaKWh: (e - ex.predWh) / 1000,
      deltaMinutes: tripMinutes(trip) - minutes, socArrivePct: req.socStartPct - (e / cap) * 100 };
  };
  const whatIf: WhatIf[] = [];
  const hw = t.parts.find((x) => x.type === "highway" && x.km > 0);
  const floor = num("whatIfHighwayFloor");
  if (hw && hw.speedKmh > floor) {
    const v = Math.max(floor, hw.speedKmh - num("whatIfHighwayDrop"));
    whatIf.push(scenario("highway-slower", lang === "uk" ? `Траса ${v} км/год замість ${hw.speedKmh}` : `Highway at ${v} km/h instead of ${hw.speedKmh}`,
      { ...t, parts: t.parts.map((x) => (x === hw ? { ...x, speedKmh: v } : x)) }));
  }
  whatIf.push(scenario("all-10pct-slower", lang === "uk" ? `Усі ділянки на ${pct(1 - num("whatIfSlowerShare"))} % повільніше` : `All parts ${pct(1 - num("whatIfSlowerShare"))} % slower`,
    { ...t, parts: t.parts.map((x) => ({ ...x, speedKmh: x.speedKmh * num("whatIfSlowerShare") })) }));
  if (Math.abs(t.tempC - num("comfortTemp")) > num("whatIfClimateDelta")) {
    whatIf.push(scenario("eco-climate", lang === "uk" ? `Економний режим клімат-системи (−${pct(1 - num("whatIfEcoHvacShare"))} % потужності)` : `Eco climate mode (−${pct(1 - num("whatIfEcoHvacShare"))} % HVAC)`,
      t, { ...p, hvacWPerDeg: p.hvacWPerDeg * num("whatIfEcoHvacShare") }));
  }
  if (t.tempC < num("whatIfColdTemp")) {
    whatIf.push(scenario("warmer-departure", lang === "uk" ? `Виїзд удень, на ${num("whatIfWarmerBy")} °C тепліше` : `Daytime departure, ${num("whatIfWarmerBy")} °C warmer`,
      { ...t, tempC: t.tempC + num("whatIfWarmerBy") }));
  }

  return {
    km, minutes,
    energyKWh: ex.predWh / 1000, energyLowKWh: (ex.predWh * lo) / 1000, energyHighKWh: (ex.predWh * hi) / 1000,
    whPerKm: ex.predWh / km,
    socStartPct: req.socStartPct, socUsedPct: socUsed, socArrivePct: socArrive, socArriveWorstPct: socWorst,
    socArriveMinPct: minArrive, status,
    personalFactor: k, historyTrips: req.historyRatios?.length ?? 0,
    baseKWh: ex.baseWh / 1000,
    contributions: FACTORS.map((f) => ({ factor: f, label: factorName(f, lang), kWh: ex.phi[f] / 1000, socPct: (ex.phi[f] / cap) * 100 })),
    explanation: explanationText(ex, t, k, p.usableKWh, lang),
    whatIf,
  };
}
