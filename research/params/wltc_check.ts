// Перевірка усередненої моделі ділянки (physics.ts) проти посекундного інтегрування циклу WLTC 3b
// з тими самими параметрами: чи компенсує еквівалентна кількість розгонів n = PKE·1000/v² втрати
// на розгони, яких модель із середньою швидкістю не бачить.
// Запуск: node --experimental-strip-types --no-warnings research/params/wltc_check.ts → results/wltc_check.json
import { readFileSync, writeFileSync } from "node:fs";
import { VEHICLE_CATALOG, airDensity, num, segmentEnergyWh, type VehicleParams } from "../../lib/energy/src/index.ts";

const here = new URL(".", import.meta.url);
const wltc = JSON.parse(readFileSync(new URL("results/wltc.json", here), "utf8"));
const v = (JSON.parse(readFileSync(new URL("data/wltc_class3b_kmh.json", here), "utf8")).kmh as number[]).map((x) => x / 3.6);
const LAMBDA = 0.0411, G = num("g");

/** Посекундне інтегрування: тяга через η_d, рекуперація exp(−λ/|a|)·η_r/0,898, допоміжні системи щосекунди */
function dynamicWh(p: VehicleParams, seg: number[], tempC: number) {
  const rho = airDensity(tempC), regenBase = p.regenEff / wltc.braking.regen_fraction_weighted;
  const aux = p.auxBaseW + p.hvacWPerDeg * Math.abs(tempC - num("comfortTemp"));
  let j = 0;
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i] - seg[i - 1], vm = (seg[i] + seg[i - 1]) / 2;
    const f = p.massKg * a + (vm > 0 ? p.crr * p.massKg * G : 0) + 0.5 * rho * p.cd * p.frontalAreaM2 * vm * vm;
    const w = f * vm;
    j += w >= 0 ? w / p.drivetrainEff : w * regenBase * (a < 0 ? Math.exp(-LAMBDA / -a) : 1);
    j += aux;
  }
  return j / 3600;
}

const rows = [];
for (const phase of ["city", "high", "extra_high"]) {
  const ph = wltc.phases[phase], [a, b] = ph.parts, seg = v.slice(a, b + 1);
  const speedMs = ph.moving_speed_kmh / 3.6, lengthM = ph.distance_km * 1000;
  for (const tempC of [23, -5]) {
    const err = (stopsPerKm: number) => VEHICLE_CATALOG.map((m) => {
      const avg = segmentEnergyWh(m.params, { lengthM, speedMs, gradePct: 0, tempC, stopsPerKm }).energyWh;
      return (100 * (avg - dynamicWh(m.params, seg, tempC))) / dynamicWh(m.params, seg, tempC);
    });
    const mean = (xs: number[]) => +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1);
    const fullStops = err(ph.full_stops_per_km), pke = err((ph.pke_m_s2 * 1000) / speedMs ** 2);
    rows.push({ phase, tempC, fullStopsErrPct: mean(fullStops), pkeErrPct: mean(pke),
      pkeErrRangePct: [+Math.min(...pke).toFixed(1), +Math.max(...pke).toFixed(1)] });
  }
}
writeFileSync(new URL("results/wltc_check.json", here), JSON.stringify({ vehicles: VEHICLE_CATALOG.length, rows }, null, 1) + "\n");
console.table(rows);
