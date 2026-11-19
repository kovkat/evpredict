// Опис поїздки на рівні, доступному водієві без телеметрії: частини маршруту за типами доріг
import { type VehicleParams, segmentEnergyWh } from "./physics.ts";
import { num } from "./params.ts";

export type RoadType = "city" | "suburban" | "highway";

export interface TripPart {
  type: RoadType;
  km: number;          // довжина частини, км
  speedKmh: number;    // середня швидкість руху (без простоїв), км/год
  stopsPerKm: number;  // розгони з місця на 1 км: зупинки й пригальмовування в потоці (еквівалент за PKE)
}

export interface TripInput {
  parts: TripPart[];
  tempC: number;       // температура повітря, °C
  elevGainM: number;   // сумарний набір висоти, м
  elevLossM: number;   // сумарний спуск, м
  headWindMs?: number; // середній зустрічний вітер, м/с
}

export const DEFAULT_PARTS: Record<RoadType, Omit<TripPart, "km">> = {
  city: { type: "city", speedKmh: num("citySpeed"), stopsPerKm: num("cityStops") },
  suburban: { type: "suburban", speedKmh: num("suburbanSpeed"), stopsPerKm: num("suburbanStops") },
  highway: { type: "highway", speedKmh: num("highwaySpeed"), stopsPerKm: num("highwayStops") },
};

export const tripKm = (t: TripInput) => t.parts.reduce((s, p) => s + p.km, 0);
export const tripMinutes = (t: TripInput) => t.parts.reduce((s, p) => s + (p.km / p.speedKmh) * 60, 0);

/** Енергія підйомів і спусків: робота проти сили тяжіння через ККД приводу; на спусках — рекуперація */
export function reliefEnergyWh(p: VehicleParams, gainM: number, lossM: number) {
  const g = num("g");
  return (p.massKg * g * gainM / p.drivetrainEff - p.massKg * g * lossM * p.regenEff) / 3600;
}

/** Фізична оцінка енергії поїздки, Вт·год */
export function tripEnergyWh(p: VehicleParams, t: TripInput) {
  let e = 0;
  for (const part of t.parts) {
    if (part.km <= 0) continue;
    e += segmentEnergyWh(p, { lengthM: part.km * 1000, speedMs: part.speedKmh / 3.6, gradePct: 0,
      tempC: t.tempC, headWindMs: t.headWindMs, stopsPerKm: part.stopsPerKm }).energyWh;
  }
  return e + reliefEnergyWh(p, t.elevGainM, t.elevLossM);
}

const PART_NAME: Record<RoadType, string> = { city: "міської ділянки", suburban: "приміської ділянки", highway: "траси" };

export function validateTrip(t: TripInput): string[] {
  const errors: string[] = [];
  if (!t.parts.length || tripKm(t) <= 0) errors.push("Довжина поїздки має бути більшою за 0 км");
  for (const p of t.parts) {
    if (p.km < 0 || p.km > 2000) errors.push(`Некоректна довжина ${PART_NAME[p.type]}`);
    if (p.km > 0 && (p.speedKmh < 5 || p.speedKmh > 200)) errors.push(`Швидкість ${PART_NAME[p.type]} має бути від 5 до 200 км/год`);
    if (p.stopsPerKm < 0 || p.stopsPerKm > 10) errors.push(`Некоректна кількість розгонів ${PART_NAME[p.type]}`);
  }
  if (t.tempC < -40 || t.tempC > 50) errors.push("Температура має бути від −40 до 50 °C");
  if (t.elevGainM < 0 || t.elevLossM < 0) errors.push("Набір і спуск висоти не можуть бути від'ємними");
  return errors;
}
