// Енергоорієнтована маршрутизація з обмеженням ресурсу (заряду батареї) — RCSPP, label-setting + A*,
// а також базовий планувальник (Дейкстра з постійним споживанням) для порівняння.
import { type VehicleParams, segmentEnergyWh } from "./physics.ts";
import { num } from "./params.ts";

export interface RouteNode { id: string; x: number; y: number; elevM: number; chargerKW?: number; reliability?: number; }
export interface RouteEdge { from: string; to: string; lengthKm: number; speedKmh: number; }
export interface Graph { nodes: Map<string, RouteNode>; adj: Map<string, RouteEdge[]>; }

export interface PlanOptions {
  tempC: number;
  socStart: number;        // початковий SoC, 0..1
  socMin: number;          // мінімально допустимий SoC (резерв), 0..1
  socArriveMin: number;    // мінімальний SoC у пункті призначення
  chargeTargets: number[]; // допустимі рівні дозаряджання, напр. [0.6, 0.8]
  personalFactor: number;  // коефіцієнт персоналізації k
  useHeuristic: boolean;   // A* (true) чи Дейкстра-подібний пошук (false)
  vMaxKmh: number;
  /** Власна модель енергії ребра, Вт·год (за замовчуванням — фізична модель × k) */
  edgeEnergy?: (e: RouteEdge) => number;
  /** Запас на невизначеність прогнозу: енергія ребра множиться на цей коефіцієнт під час перевірки обмежень */
  safetyFactor?: number;
  /** Станції з нижчою оцінкою надійності не використовуються для заряджання */
  minReliability?: number;
  /** Очікувані втрати часу, якщо станція не працює, год; додаються з вагою (1 − надійність) */
  failurePenaltyH?: number;
  /** Станції, які не можна використовувати (наприклад, щойно виявилися непрацюючими) */
  exclude?: ReadonlySet<string>;
  /** Додатковий резерв SoC при прибутті на станцію: якщо вона не працює, має вистачити заряду доїхати до іншої */
  stationArrivalReserve?: number;
  /** Допуск домінування за SoC (частка): мітка з майже тим самим зарядом і не меншим часом відкидається.
   *  0 — точний пошук; 0,005 (0,5 п. п.) різко зменшує кількість міток на великих графах */
  socTolerance?: number;
}

export interface Label { node: string; timeH: number; soc: number; energyWh: number; prev?: Label; action?: string; chargeTo?: number; f?: number; }

export function buildGraph(nodes: RouteNode[], edges: RouteEdge[], directed = false): Graph {
  const g: Graph = { nodes: new Map(nodes.map(n => [n.id, n])), adj: new Map() };
  for (const n of nodes) g.adj.set(n.id, []);
  for (const e of edges) {
    g.adj.get(e.from)!.push(e);
    if (!directed) g.adj.get(e.to)!.push({ ...e, from: e.to, to: e.from });
  }
  return g;
}

export function edgeEnergyWh(g: Graph, e: RouteEdge, p: VehicleParams, tempC: number, k: number) {
  const a = g.nodes.get(e.from)!, b = g.nodes.get(e.to)!;
  const gradePct = ((b.elevM - a.elevM) / (e.lengthKm * 1000)) * 100;
  const r = segmentEnergyWh(p, { lengthM: e.lengthKm * 1000, speedMs: e.speedKmh / 3.6, gradePct, tempC });
  return r.energyWh * k;
}

/** Час заряджання (год) від socA до socB зі зниженням потужності після 80 % */
export function chargeTimeH(p: VehicleParams, stationKW: number, socA: number, socB: number) {
  const step = num("chargeStep"), knee = num("chargeKnee"), taper = num("chargeTaper"); let t = 0;
  for (let s = socA; s < socB - 1e-9; s += step) {
    const kw = s < knee ? stationKW : stationKW * taper;
    t += (p.usableKWh * step) / kw;
  }
  return t + 1 / 60 * num("connectMinutes"); // під'єднання й оплата
}

/** Бінарна купа для черги міток: вибір мінімуму за O(log n) */
class MinHeap<T> {
  private a: T[] = [];
  private key: (x: T) => number;
  constructor(key: (x: T) => number) { this.key = key; }
  get size() { return this.a.length; }
  push(x: T) {
    const a = this.a; a.push(x); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.key(a[p]) <= this.key(a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): T | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.key(a[l]) < this.key(a[m])) m = l;
        if (r < a.length && this.key(a[r]) < this.key(a[m])) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** RCSPP: мінімальний час поїздки з обмеженням на рівень заряду і заряджанням у вершинах-станціях */
export function plan(g: Graph, src: string, dst: string, p: VehicleParams, o: PlanOptions) {
  const target = g.nodes.get(dst)!;
  const safety = o.safetyFactor ?? 1;
  const h = (id: string) => {
    if (!o.useHeuristic) return 0;
    const n = g.nodes.get(id)!;
    return Math.hypot(n.x - target.x, n.y - target.y) / o.vMaxKmh; // допустима оцінка часу
  };
  const energyCache = new Map<RouteEdge, number>();
  const energy = (e: RouteEdge) => {
    let v = energyCache.get(e);
    if (v === undefined) { v = o.edgeEnergy ? o.edgeEnergy(e) : edgeEnergyWh(g, e, p, o.tempC, o.personalFactor); energyCache.set(e, v); }
    return v;
  };
  const settled = new Map<string, Label[]>(); // Парето-множина міток у вузлі
  let expanded = 0;
  const tol = Math.max(o.socTolerance ?? 0, 1e-12);
  const minInc = num("minChargeIncrement");
  const dominated = (l: Label) =>
    (settled.get(l.node) ?? []).some(m => m.timeH <= l.timeH + 1e-12 && m.soc >= l.soc - tol);
  // пріоритет f = t + h(v) обчислюється один раз під час створення мітки, а не під час кожного порівняння в купі
  const open = new MinHeap<Label>((l) => l.f!);
  const pushLabel = (l: Label) => {
    if (dominated(l)) return;          // мітку, вже доміновану встановленою, не додаємо в чергу
    l.f = l.timeH + h(l.node);
    open.push(l);
  };
  pushLabel({ node: src, timeH: 0, soc: o.socStart, energyWh: 0 });

  while (open.size) {
    const cur = open.pop()!;
    if (dominated(cur)) continue;
    const here = settled.get(cur.node); if (here) here.push(cur); else settled.set(cur.node, [cur]);
    expanded++;
    if (cur.node === dst && cur.soc >= o.socArriveMin) return { label: cur, expanded };
    const node = g.nodes.get(cur.node)!;
    // дія «заряджання» у вузлі зі станцією
    if (node.chargerKW && (node.reliability ?? 1) >= (o.minReliability ?? 0) && !o.exclude?.has(cur.node)) {
      const risk = (1 - (node.reliability ?? 1)) * (o.failurePenaltyH ?? 0);
      for (const tgt of o.chargeTargets) if (tgt > cur.soc + minInc) {
        const dt = chargeTimeH(p, node.chargerKW, cur.soc, tgt);
        pushLabel({ node: cur.node, timeH: cur.timeH + dt + risk, soc: tgt, energyWh: cur.energyWh, prev: cur, chargeTo: tgt,
          action: `заряджання ${Math.round(cur.soc * 100)}→${Math.round(tgt * 100)} % (${Math.round(dt * 60)} хв)` });
      }
    }
    // дія «рух ребром»
    for (const e of g.adj.get(cur.node)!) {
      const eWh = energy(e);
      const soc = Math.min(1, cur.soc - (eWh * safety) / (p.usableKWh * 1000)); // рекуперація не перевищує 100 %
      if (soc < o.socMin) continue; // порушення ресурсного обмеження
      const next = g.nodes.get(e.to)!;
      if (o.stationArrivalReserve && e.to !== dst && next.chargerKW && soc < o.socMin + o.stationArrivalReserve) continue;
      pushLabel({ node: e.to, timeH: cur.timeH + e.lengthKm / e.speedKmh, soc, energyWh: cur.energyWh + eWh, prev: cur,
        action: `${e.from}→${e.to}` });
    }
  }
  return { label: undefined, expanded };
}

export function unwind(l?: Label) {
  const out: Label[] = []; while (l) { out.unshift(l); l = l.prev; } return out;
}

// ---------------------------------------------------------------------------------------------
// Спільне подання плану поїздки: послідовність вершин і, за потреби, цільовий SoC заряджання в них

export interface PlanStep { node: string; chargeTo?: number; socArrive?: number; }
export interface TripPlan { steps: PlanStep[]; plannedTimeH: number; plannedArriveSoc: number; expanded: number; }

/** Перетворення мітки RCSPP на послідовність кроків */
export function labelToPlan(l: Label | undefined, expanded: number): TripPlan | null {
  if (!l) return null;
  const labels = unwind(l);
  const steps: PlanStep[] = [];
  for (const x of labels) {
    if (x.chargeTo !== undefined) steps[steps.length - 1].chargeTo = x.chargeTo;
    else if (!steps.length || steps[steps.length - 1].node !== x.node) steps.push({ node: x.node, socArrive: x.soc });
  }
  return { steps, plannedTimeH: l.timeH, plannedArriveSoc: l.soc, expanded };
}

export interface BaselineOptions {
  whPerKm: number;     // постійне питоме споживання («паспортне»)
  socStart: number;
  socMin: number;
  chargeTo: number;    // заряджання на кожній зупинці до цього рівня (типово 0,8)
  exclude?: ReadonlySet<string>;
}

/**
 * Базовий планувальник, як у простих навігаторах: алгоритм Дейкстри за часом на графі досяжності.
 * Енергія ребра = довжина × постійне споживання; погода, швидкість, стиль водіння і надійність станцій
 * не враховуються; на кожній зупинці — заряджання до chargeTo.
 */
export function planBaseline(g: Graph, src: string, dst: string, p: VehicleParams, o: BaselineOptions): TripPlan | null {
  const cap = p.usableKWh * 1000;
  const dist = new Map<string, number>([[src, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  const heap = new MinHeap<[string, number]>((x) => x[1]);
  heap.push([src, 0]);
  let expanded = 0;
  while (heap.size) {
    const [u, d] = heap.pop()!;
    if (done.has(u) || d > (dist.get(u) ?? Infinity)) continue;
    done.add(u); expanded++;
    if (u === dst) break;
    const socDepart = u === src ? o.socStart : o.chargeTo;
    for (const e of g.adj.get(u)!) {
      const socArrive = socDepart - (e.lengthKm * o.whPerKm) / cap;
      if (socArrive < o.socMin) continue;
      const v = g.nodes.get(e.to)!;
      const isStop = e.to !== dst;
      if (isStop && (!v.chargerKW || o.exclude?.has(e.to))) continue;
      const charge = isStop ? chargeTimeH(p, v.chargerKW!, Math.min(socArrive, o.chargeTo), o.chargeTo) : 0;
      const nd = d + e.lengthKm / e.speedKmh + charge;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); heap.push([e.to, nd]); }
    }
  }
  if (!dist.has(dst)) return null;
  const nodes = [dst]; while (nodes[0] !== src) nodes.unshift(prev.get(nodes[0])!);
  const steps: PlanStep[] = nodes.map((n, i) => (i > 0 && i < nodes.length - 1 ? { node: n, chargeTo: o.chargeTo } : { node: n }));
  const last = g.adj.get(nodes[nodes.length - 2])!.find((e) => e.to === dst)!;
  const lastDepart = nodes.length > 2 ? o.chargeTo : o.socStart;
  return { steps, plannedTimeH: dist.get(dst)!, plannedArriveSoc: lastDepart - (last.lengthKm * o.whPerKm) / cap, expanded };
}
