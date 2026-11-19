// Чутливість прогнозу енергії до фізичних параметрів у межах, які дають самі джерела.
// Типові поїздки Nissan Leaf 40: місто взимку, траса влітку, змішана восени.
// Запуск: node --experimental-strip-types --no-warnings research/params/physics_sensitivity.ts → results/physics_sensitivity.json
import { writeFileSync } from "node:fs";
import { DEFAULT_PARTS, findVehicle, num, tripEnergyWh, type TripInput, type VehicleParams } from "../../lib/energy/src/index.ts";

const leaf = findVehicle("nissan-leaf-40")!.params;
const trips: Record<string, TripInput> = {
  "місто, −5 °C, 15 км": { parts: [{ ...DEFAULT_PARTS.city, km: 15 }], tempC: -5, elevGainM: 0, elevLossM: 0 },
  "траса, 25 °C, 120 км": { parts: [{ ...DEFAULT_PARTS.city, km: 5 }, { ...DEFAULT_PARTS.highway, km: 115 }], tempC: 25, elevGainM: 0, elevLossM: 0 },
  "змішана, 10 °C, 40 км": { parts: [{ ...DEFAULT_PARTS.city, km: 10 }, { ...DEFAULT_PARTS.suburban, km: 20 }, { ...DEFAULT_PARTS.highway, km: 10 }],
    tempC: 10, elevGainM: 0, elevLossM: 0 },
};
type Var = { param: string; range: [number, number]; source: string; apply: (p: VehicleParams, t: TripInput, x: number) => [VehicleParams, TripInput] };
const veh = (k: keyof VehicleParams) => (p: VehicleParams, t: TripInput, x: number): [VehicleParams, TripInput] => [{ ...p, [k]: x }, t];
const part = (type: string, k: "speedKmh" | "stopsPerKm") => (p: VehicleParams, t: TripInput, x: number): [VehicleParams, TripInput] =>
  [p, { ...t, parts: t.parts.map((q) => (q.type === type ? { ...q, [k]: x } : q)) }];
const vars: Var[] = [
  { param: "rollingResistance", range: [0.0072, 0.0106], source: "класи B–E за Регламентом (ЄС) 2020/740 (середина B, нижня межа E)", apply: veh("crr") },
  { param: "drivetrainEff", range: [0.8, 0.88], source: "±5 % від 0,84", apply: veh("drivetrainEff") },
  { param: "regenEff", range: [0.6, 0.83], source: "0,6 – попереднє значення; 0,83 – без втрат на тертя (0,92 · 0,91 · 1)", apply: veh("regenEff") },
  { param: "auxBasePower", range: [144, 226], source: "два BEV у звіті DOE", apply: veh("auxBaseW") },
  { param: "hvacPerDegree", range: [79, 96], source: "нахили двох BEV окремо (hvac_fit.py)", apply: veh("hvacWPerDeg") },
  // T_c впливає через |T − T_c|; зсув T_c на Δ еквівалентний зсуву температури поїздки на −Δ
  { param: "comfortTemp", range: [20, 22.2], source: "20 °C; 22,2 °C – уставка в тестах DOE", apply: (p, t, x) => [p, { ...t, tempC: t.tempC - (x - num("comfortTemp")) }] },
  { param: "citySpeed", range: [25.3, 44.5], source: "фази Low і Medium WLTC окремо", apply: part("city", "speedKmh") },
  { param: "cityStops", range: [0.21, 1.62], source: "фази Medium і Low WLTC окремо", apply: part("city", "stopsPerKm") },
  { param: "suburbanSpeed", range: [44.5, 94], source: "фази Medium і Extra-high WLTC", apply: part("suburban", "speedKmh") },
];
const rows = [];
for (const [name, t] of Object.entries(trips)) {
  const base = tripEnergyWh(leaf, t);
  for (const v of vars) {
    const [lo, hi] = v.range.map((x) => { const [p, tt] = v.apply(leaf, t, x); return tripEnergyWh(p, tt); });
    rows.push({ trip: name, param: v.param, range: v.range, source: v.source, baseKWh: +(base / 1000).toFixed(2),
      loPct: +((100 * (lo - base)) / base).toFixed(1), hiPct: +((100 * (hi - base)) / base).toFixed(1) });
  }
}
writeFileSync(new URL("results/physics_sensitivity.json", import.meta.url), JSON.stringify(rows, null, 1) + "\n");
console.table(rows.map(({ source, range, ...r }) => r));
