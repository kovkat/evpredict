// Персоналізація прогнозу за історією поїздок
import type { VehicleParams } from "./physics.ts";
import { updatePersonalFactor } from "./physics.ts";
import { type TripInput, type RoadType, tripEnergyWh } from "./trip.ts";
import { energyWithFactors, FACTORS } from "./explain.ts";
import { num, list } from "./params.ts";

export interface TripRecord {
  id: string;
  date: string;                 // ISO-дата
  trip: TripInput;
  socStartPct: number;
  socEndPct: number;
  actualKWh: number;            // фактична енергія (з різниці SoC або з телеметрії)
  source: "manual" | "csv" | "simulator" | "dataset" | "bluetooth-obd";
  profile?: string;             // для синтетичних поїздок — профіль водія
}

export interface ReplayRow {
  id: string;
  date: string;
  km: number;
  modelKWh: number;             // прогноз без персоналізації
  predictedKWh: number;         // прогноз з k, відомим до поїздки
  actualKWh: number;
  kBefore: number;
  kAfter: number;
  errorModelPct: number;
  errorPersonalPct: number;
  reliable: boolean;            // чи достатньо точні покази SoC, щоб навчатися на цій поїздці
}

export interface ReplaySummary {
  trips: number;
  reliableTrips: number;
  personalFactor: number;
  mapeModelPct: number;
  mapePersonalPct: number;
  mapePersonalLast10Pct: number | null;
  ratios: number[];             // факт / прогноз без персоналізації — для інтервалу прогнозу
  roadFactors: Record<RoadType, number>; // персональні коефіцієнти за типами доріг
  rows: ReplayRow[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Мінімальне зниження SoC, за якого поїздка використовується для навчання.
 *  Покази SoC з панелі приладів цілі (крок 1 %), тому для короткої поїздки зі зниженням на 3 %
 *  похибка зчитування сягає ±33 % — така поїздка лише зашумлює коефіцієнт k. */
export const MIN_SOC_DROP_FOR_LEARNING = num("minSocDropPct");

/** Послідовне «програвання» історії: прогноз до поїздки з поточним k, потім оновлення k фактом */
export function replayHistory(p: VehicleParams, records: TripRecord[], alpha = num("ewmaAlpha"), minSocDropPct = MIN_SOC_DROP_FOR_LEARNING): ReplaySummary {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  let k = 1;
  const rows: ReplayRow[] = [];
  for (const r of sorted) {
    if (!(r.actualKWh > 0)) continue;
    const model = tripEnergyWh(p, r.trip) / 1000;
    const pred = model * k;
    const reliable = r.source === "bluetooth-obd" || r.socStartPct - r.socEndPct >= minSocDropPct;
    const kAfter = reliable ? updatePersonalFactor(k, r.actualKWh, model, alpha) : k;
    rows.push({ id: r.id, date: r.date, km: r.trip.parts.reduce((s, x) => s + x.km, 0),
      modelKWh: model, predictedKWh: pred, actualKWh: r.actualKWh, kBefore: k, kAfter,
      errorModelPct: (Math.abs(r.actualKWh - model) / r.actualKWh) * 100,
      errorPersonalPct: (Math.abs(r.actualKWh - pred) / r.actualKWh) * 100, reliable });
    k = kAfter;
  }
  // точність оцінюється лише на поїздках з надійними показами SoC
  const rel = rows.filter((x) => x.reliable);
  const last10 = rel.slice(-10);
  return {
    trips: rows.length, reliableTrips: rel.length, personalFactor: k,
    mapeModelPct: mean(rel.map((x) => x.errorModelPct)),
    mapePersonalPct: mean(rel.map((x) => x.errorPersonalPct)),
    mapePersonalLast10Pct: rel.length >= 15 ? mean(last10.map((x) => x.errorPersonalPct)) : null,
    ratios: rel.map((x) => x.actualKWh / x.modelKWh),
    roadFactors: fitRoadFactors(p, sorted.filter((r) => rows.find((x) => x.id === r.id)?.reliable), k),
    rows,
  };
}

const ROADS: RoadType[] = ["city", "suburban", "highway"];

/**
 * Персональні коефіцієнти для кожного типу дороги: фактична енергія поїздки ≈ Σ k_t · E_t,
 * де E_t — модельна енергія частини поїздки типу t. Гребенева регресія стягує коефіцієнти до
 * загального k, тому тип дороги, якого в історії мало, не отримує випадкового значення.
 * Потрібна, бо стиль водіння по-різному проявляється в місті (розгони) і на трасі (швидкість).
 */
export function fitRoadFactors(p: VehicleParams, records: TripRecord[], kGlobal = 1, lambda = num("ridgeLambda")): Record<RoadType, number> {
  // нормальні рівняння (MᵀM + λ·D) k = Mᵀa + λ·D·kGlobal, D — діагональ масштабів
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const r of records) {
    const m = ROADS.map((t) => {
      const parts = r.trip.parts.filter((x) => x.type === t);
      if (!parts.length) return 0;
      const share = parts.reduce((s, x) => s + x.km, 0) / r.trip.parts.reduce((s, x) => s + x.km, 0);
      const base = energyWithFactors(p, { ...r.trip, parts }, new Set(FACTORS.filter((f) => f !== "relief" && f !== "personal")), 1);
      return (base + share * (tripEnergyWh(p, r.trip) - energyWithFactors(p, r.trip, new Set(FACTORS.filter((f) => f !== "relief" && f !== "personal")), 1))) / 1000;
    });
    for (let i = 0; i < 3; i++) { b[i] += m[i] * r.actualKWh; for (let j = 0; j < 3; j++) A[i][j] += m[i] * m[j]; }
  }
  const scale = A.map((row, i) => Math.max(row[i], 1e-6) / Math.max(records.length, 1));
  for (let i = 0; i < 3; i++) { A[i][i] += lambda * scale[i]; b[i] += lambda * scale[i] * kGlobal; }
  const k = solve3(A, b);
  return { city: clampK(k[0], kGlobal), suburban: clampK(k[1], kGlobal), highway: clampK(k[2], kGlobal) };
}

const clampK = (x: number, fallback: number) => {
  const [lo, hi] = list("roadFactorClip");
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
};

function solve3(A: number[][], b: number[]) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    if (Math.abs(m[c][c]) < 1e-12) return [NaN, NaN, NaN];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let j = c; j < 4; j++) m[r][j] -= f * m[c][j]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Фактична енергія за показами SoC (ручне введення) */
export const energyFromSoc = (p: VehicleParams, socStartPct: number, socEndPct: number) =>
  ((socStartPct - socEndPct) / 100) * p.usableKWh;
