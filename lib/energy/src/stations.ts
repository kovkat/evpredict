// Зарядні станції: оцінка надійності за відкритими даними та побудова графа станцій у коридорі маршруту
import type { Connector } from "./vehicles.ts";
import type { Graph, RouteEdge, RouteNode } from "./routing.ts";
import { buildGraph } from "./routing.ts";
import { num, list } from "./params.ts";

export interface StationRecord {
  id: number;
  title: string;
  town: string;
  lat: number;
  lon: number;
  maxKw: number;
  dc: boolean;
  connectors: string[];
  points: number;
  statusTypeId: number | null;
  operatorId?: number | null;
  lastVerified: string | null;
  checkinsOk: number;
  checkinsFailed: number;
  elevM?: number;          // висота станції над рівнем моря, м (з цифрової моделі рельєфу)
  own?: boolean;           // власна точка заряду користувача (дім, знайома розетка): AC або DC, без даних реєстру
}

export interface Reliability {
  score: number;                       // апріорна ймовірність, що станція працює, 0..1
  factors: { label: string; delta: number }[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Евристична оцінка надійності станції за даними Open Charge Map.
 * Ураховує статус, давність останньої перевірки, відгуки «зарядився / не вдалося» і кількість точок
 * заряджання (якщо їх кілька, вища ймовірність, що хоча б одна працює).
 */
export function reliabilityScore(s: StationRecord, now = new Date()): Reliability {
  if (s.own) return { score: num("ownStationReliability"), factors: [{ label: "own charging point", delta: num("ownStationReliability") }] };
  const factors: { label: string; delta: number }[] = [];
  // коди статусів Open Charge Map: 10/20/50 — працює, 75 — працює частково, 30 — тимчасово недоступна,
  // 100 — не працює, 150 — запланована, ≥ 200 — виведена з експлуатації; 0 або відсутній — невідомо
  const st = s.statusTypeId;
  const base = st === 50 || st === 10 || st === 20 ? num("relBaseWorking") : st === 75 ? num("relBasePartial")
    : st === 30 ? num("relBaseTemporarilyDown") : st === 100 ? num("relBaseDown")
    : st !== null && st >= 150 ? num("relBasePlanned") : num("relBaseUnknown");
  factors.push({ label: "status", delta: base });
  let p = base;
  if (s.lastVerified) {
    const years = (now.getTime() - new Date(s.lastVerified).getTime()) / (365.25 * 86400000);
    const [a1, a2, a3] = list("relAgeYears"), [d1, d2, d3, d4] = list("relAgeAdjust");
    const d = years <= a1 ? d1 : years <= a2 ? d2 : years <= a3 ? d3 : d4;
    p += d; factors.push({ label: `verified ${years.toFixed(1)} years ago`, delta: d });
  } else { const d = num("relNeverVerified"); p += d; factors.push({ label: "never verified", delta: d }); }
  if (s.checkinsOk) { const d = Math.min(num("relCheckinOkMax"), num("relCheckinOk") * s.checkinsOk); p += d; factors.push({ label: "successful check-ins", delta: d }); }
  if (s.checkinsFailed) { const d = num("relCheckinFail") * s.checkinsFailed; p += d; factors.push({ label: "failed check-ins", delta: d }); }
  const [lo, hi] = list("relClip");
  p = clamp(p, lo, hi);
  const n = Math.min(Math.max(s.points, 1), num("relPointsMax"));
  if (n > 1) {
    const site = 1 - (1 - p) ** (1 + num("relPointsGamma") * (n - 1));   // точки однієї станції не повністю незалежні
    factors.push({ label: `${s.points} charging points`, delta: site - p });
    p = site;
  }
  return { score: clamp(p, lo, num("relSiteMax")), factors };
}

export const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
};

export interface Place { id: string; lat: number; lon: number; elevM?: number; }

/** Початковий азимут руху з точки a в точку b, градуси від півночі за годинниковою стрілкою */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180, f1 = a.lat * r, f2 = b.lat * r, dl = (b.lon - a.lon) * r;
  const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/** Вітер: швидкість і напрямок, звідки він дме (метеорологічна домовленість: 0 – з півночі, 90 – зі сходу) */
export interface Wind { speedMs: number; fromDeg: number; }

/** Складова вітру назустріч руху з азимутом bearing, м/с: додатна – зустрічний, від'ємна – попутний */
export const headWindComponent = (w: Wind, bearing: number) => w.speedMs * Math.cos(((w.fromDeg - bearing) * Math.PI) / 180);

/** Середній вітер кількох точок: усереднення векторів, а не окремо швидкостей і напрямків */
export function meanWind(ws: Wind[]): Wind {
  const r = Math.PI / 180;
  const x = ws.reduce((s, w) => s + w.speedMs * Math.sin(w.fromDeg * r), 0) / ws.length;
  const y = ws.reduce((s, w) => s + w.speedMs * Math.cos(w.fromDeg * r), 0) / ws.length;
  return { speedMs: Math.hypot(x, y), fromDeg: ((Math.atan2(x, y) / r) + 360) % 360 };
}  // висота над рівнем моря, м (якщо відома)

export interface CorridorOptions {
  corridorKm: number;        // максимальна відстань станції від прямої A–B
  circuity: number;          // коефіцієнт непрямолінійності доріг (дорожня / пряма відстань), ≈ 1,2–1,3
  maxEdgeKm: number;         // максимальна довжина ребра між вузлами графа
  highwayKmh: number;        // середня швидкість на міжміських ділянках
  connectors: Connector[];   // роз'єми автомобіля
  vehicleMaxDcKw: number;
  vehicleMaxAcKw?: number;   // бортовий зарядний пристрій: обмежує потужність власних AC-точок
  now?: Date;
}

export interface CorridorNode extends RouteNode { lat: number; lon: number; reliability?: number; station?: StationRecord; }

/** Зведений граф: A, B і сумісні DC-станції в коридорі; ребра — «вперед» уздовж маршруту */
export function buildCorridorGraph(a: Place, b: Place, stations: StationRecord[], o: CorridorOptions): { graph: Graph; nodes: CorridorNode[] } {
  const total = haversineKm(a.lat, a.lon, b.lat, b.lon);
  const toXY = (lat: number, lon: number) => ({
    x: haversineKm(a.lat, a.lon, a.lat, lon) * Math.sign(lon - a.lon),
    y: haversineKm(a.lat, a.lon, lat, a.lon) * Math.sign(lat - a.lat),
  });
  const B = toXY(b.lat, b.lon);
  const ux = B.x / total, uy = B.y / total;
  const nodes: CorridorNode[] = [
    { id: a.id, lat: a.lat, lon: a.lon, x: 0, y: 0, elevM: a.elevM ?? 0 },
    { id: b.id, lat: b.lat, lon: b.lon, x: B.x, y: B.y, elevM: b.elevM ?? 0 },
  ];
  for (const s of stations) {
    // власну точку користувач позначає для свого автомобіля, тому роз'єми не перевіряються
    const ac = !!s.own && !s.dc;
    if (ac ? !(o.vehicleMaxAcKw! > 0) : !s.dc || o.vehicleMaxDcKw <= 0) continue;
    if (!s.own && !s.connectors.some((c) => (o.connectors as string[]).includes(c))) continue;
    const p = toXY(s.lat, s.lon);
    const along = p.x * ux + p.y * uy;
    const across = Math.abs(-p.x * uy + p.y * ux);
    const margin = num("corridorAlongMarginKm");
    if (along < -margin || along > total + margin || across > o.corridorKm) continue;
    const rel = reliabilityScore(s, o.now).score;
    if (rel < num("minNodeReliability")) continue;
    nodes.push({ id: s.own ? `own${s.id}` : `s${s.id}`, lat: s.lat, lon: s.lon, x: p.x, y: p.y, elevM: s.elevM ?? 0,
      chargerKW: Math.min(s.maxKw || num("defaultStationKw"), ac ? o.vehicleMaxAcKw! : o.vehicleMaxDcKw), reliability: rel, station: s, ...(ac ? { ac } : {}) });
  }
  const prog = (n: CorridorNode) => n.x * ux + n.y * uy;
  const edges: RouteEdge[] = [];
  for (const u of nodes) for (const v of nodes) {
    if (u === v || prog(v) <= prog(u) || v.id === a.id || u.id === b.id) continue;
    const km = haversineKm(u.lat, u.lon, v.lat, v.lon) * o.circuity;
    if (km > o.maxEdgeKm) continue;
    edges.push({ from: u.id, to: v.id, lengthKm: km, speedKmh: km > num("highwayEdgeMinKm") ? o.highwayKmh : num("edgeSpeedCity") });
  }
  return { graph: buildGraph(nodes, edges, true), nodes };
}
