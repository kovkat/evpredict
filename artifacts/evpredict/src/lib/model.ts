// Обчислення на боці клієнта тим самим ядром, що й на сервері (lib/energy): оцінки запасу ходу і зведення історії.
import {
  DEFAULT_PARTS, findVehicle, num, tripEnergyWh, withStateOfHealth,
  type ReplaySummary, type RoadType, type TripRecord, type VehicleParams,
} from "@workspace/energy";
import type { VehicleProfile } from "./storage";

export const ROAD_LABEL: Record<RoadType, string> = { city: "Місто", suburban: "Приміська дорога", highway: "Траса" };
export const ROADS: RoadType[] = ["city", "suburban", "highway"];

export const SOURCE_LABEL: Record<TripRecord["source"], string> = {
  manual: "вручну", csv: "CSV", simulator: "змодельована", dataset: "набір даних", "bluetooth-obd": "OBD",
};

/** Параметри автомобіля з урахуванням стану батареї */
export function vehicleParams(v: VehicleProfile | null): VehicleParams | null {
  const m = v && findVehicle(v.vehicleId);
  return m ? withStateOfHealth(m.params, v.sohPct) : null;
}

/** Персональні коефіцієнти, які застосовуються в прогнозі: за типами доріг, коли надійних поїздок достатньо */
export function personalFactors(s: ReplaySummary | null): Record<RoadType, number> {
  if (!s) return { city: 1, suburban: 1, highway: 1 };
  if (s.reliableTrips >= num("safetyMinTrips")) return s.roadFactors;
  return { city: s.personalFactor, suburban: s.personalFactor, highway: s.personalFactor };
}

/** Питоме споживання за моделлю, Вт·год/км, для рівної дороги одного типу */
export function modelWhPerKm(p: VehicleParams, road: RoadType, tempC: number, k = 1): number {
  const trip = { parts: [{ ...DEFAULT_PARTS[road], km: 100 }], tempC, elevGainM: 0, elevLossM: 0 };
  return (tripEnergyWh(p, trip) / 100) * k;
}

/** Запас ходу, км: від повного заряду до резерву на прибуття */
export function rangeKm(p: VehicleParams, road: RoadType, tempC: number, k = 1, reservePct = num("arriveReserveDefaultPct")): number {
  return (p.usableKWh * 1000 * (1 - reservePct / 100)) / modelWhPerKm(p, road, tempC, k);
}

export const tripKmOf = (r: TripRecord) => r.trip.parts.reduce((s, p) => s + p.km, 0);
export const roadKmOf = (r: TripRecord, t: RoadType) => r.trip.parts.filter((p) => p.type === t).reduce((s, p) => s + p.km, 0);

/** Квантиль вибірки з лінійною інтерполяцією */
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
