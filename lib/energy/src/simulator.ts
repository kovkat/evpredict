// Генератор синтетичних поїздок для тестування без підключення до автомобіля.
// «Фактичне» споживання формується з прихованим профілем водія, якого система не знає,
// а SoC «зчитується» з дискретністю 1 %, як під час ручного введення з панелі приладів.
import type { VehicleParams } from "./physics.ts";
import { type TripInput, type TripPart, DEFAULT_PARTS, tripEnergyWh } from "./trip.ts";
import { type TripRecord } from "./personalization.ts";
import { createRng } from "./rng.ts";

export interface DriverProfile {
  id: string;
  label: string;
  speedFactor: number;   // фактична швидкість / типова для дороги
  stopsFactor: number;   // інтенсивність розгонів (еквівалент кількості зупинок)
  hvacFactor: number;    // інтенсивність використання клімат-контролю
}

export const DRIVER_PROFILES: DriverProfile[] = [
  { id: "eco", label: "Economical", speedFactor: 0.93, stopsFactor: 0.7, hvacFactor: 0.7 },
  { id: "normal", label: "Typical", speedFactor: 1.0, stopsFactor: 1.0, hvacFactor: 1.0 },
  { id: "dynamic", label: "Dynamic", speedFactor: 1.12, stopsFactor: 1.6, hvacFactor: 1.3 },
];

// Середні місячні температури для Києва, °C (наближено)
const MONTH_TEMP = [-4, -3, 2, 9, 15, 19, 21, 20, 15, 9, 3, -2];

export interface GenerateOptions { count: number; seed: number; startDate?: string; noisePct?: number; }

export function generateTrips(p: VehicleParams, d: DriverProfile, o: GenerateOptions): TripRecord[] {
  const rng = createRng(o.seed);
  const noise = (o.noisePct ?? 3) / 100;
  const start = new Date(o.startDate ?? "2026-01-05T08:00:00Z").getTime();
  const out: TripRecord[] = [];
  let soc = 90;
  for (let i = 0; i < o.count; i++) {
    const date = new Date(start + i * 3.5 * 86400000 + rng.next() * 36000000);
    const tempC = Math.round(MONTH_TEMP[date.getUTCMonth()] + rng.gauss() * 4);
    const parts: TripPart[] = [{ ...DEFAULT_PARTS.city, km: Math.round((3 + rng.next() * 22) * 10) / 10 }];
    if (rng.next() < 0.5) parts.push({ ...DEFAULT_PARTS.suburban, km: Math.round((5 + rng.next() * 25) * 10) / 10 });
    if (rng.next() < 0.35) parts.push({ ...DEFAULT_PARTS.highway, km: Math.round((20 + rng.next() * 90) * 10) / 10 });
    const gain = Math.round(rng.next() * 8 * parts.reduce((s, x) => s + x.km, 0));
    let trip: TripInput = { parts, tempC, elevGainM: gain, elevLossM: Math.round(gain * (0.7 + rng.next() * 0.6)) };

    // приховані особливості водія
    const real: VehicleParams = { ...p, hvacWPerDeg: p.hvacWPerDeg * d.hvacFactor };
    const wind = rng.gauss() * 2, eps = rng.gauss();
    const drive = (t: TripInput) => ({ ...t, headWindMs: wind,
      parts: t.parts.map((x) => ({ ...x, speedKmh: x.speedKmh * d.speedFactor, stopsPerKm: x.stopsPerKm * d.stopsFactor })) });
    let trueKWh = (tripEnergyWh(real, drive(trip)) / 1000) * (1 + noise * eps);
    // поїздка має вміщатися в один заряд: для автомобілів з малою батареєю скорочуємо відстань
    while (trueKWh > 0.7 * p.usableKWh) {
      trip = { ...trip, elevGainM: Math.round(trip.elevGainM / 2), elevLossM: Math.round(trip.elevLossM / 2),
        parts: trip.parts.map((x) => ({ ...x, km: Math.round(x.km * 5) / 10 })) };
      trueKWh = (tripEnergyWh(real, drive(trip)) / 1000) * (1 + noise * eps);
    }

    if (soc - (trueKWh / p.usableKWh) * 100 < 15) soc = Math.round(80 + rng.next() * 20); // зарядилися перед поїздкою
    const socStart = Math.round(soc);
    const socEnd = Math.round(soc - (trueKWh / p.usableKWh) * 100);
    out.push({ id: `sim-${d.id}-${o.seed}-${i + 1}`, date: date.toISOString(), trip, socStartPct: socStart, socEndPct: socEnd,
      actualKWh: Math.round(((socStart - socEnd) / 100) * p.usableKWh * 100) / 100, source: "simulator", profile: d.id });
    soc = socEnd;
  }
  return out;
}
