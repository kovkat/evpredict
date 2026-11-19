// Довідник моделей електромобілів, поширених в Україні.
// Корисна ємність, найбільша DC-потужність і крива DC-заряджання – з Open EV Data
// (github.com/KilowattApp/open-ev-data, MIT; витяг research/params/data/oed_vehicles.json).
// Маса = споряджена маса виробника + 75 кг водія (Регламент (ЄС) 1230/2012), C_d – виробник, площа міделя =
// 0,85 · ширина · висота (Pannone 2015, CARB): research/params/vehicle_specs.py → results/vehicle_specs.json.
// ККД, опір коченню і допоміжні навантаження однакові для всіх моделей (реєстр params.ts).
import type { VehicleParams } from "./physics.ts";
import { num } from "./params.ts";

export type Connector = "CCS" | "CHAdeMO" | "Type 2" | "NACS" | "GB/T";

export interface VehicleModel {
  id: string;
  make: string;
  model: string;
  years: string;
  connectors: Connector[];
  maxDcKw: number;   // 0 — швидке заряджання постійним струмом не підтримується
  maxAcKw: number;
  params: VehicleParams;
}

const base = { crr: num("rollingResistance"), drivetrainEff: num("drivetrainEff"), regenEff: num("regenEff"),
  auxBaseW: num("auxBasePower"), hvacWPerDeg: num("hvacPerDegree") };

export const VEHICLE_CATALOG: VehicleModel[] = [
  { id: "fiat-500e-2013", make: "Fiat", model: "500e", years: "2013–2019", connectors: ["Type 2"], maxDcKw: 0, maxAcKw: 6.6,
    params: { ...base, massKg: 1430, cd: 0.311, frontalAreaM2: 2.11, usableKWh: 21.3 } },
  { id: "nissan-leaf-24", make: "Nissan", model: "Leaf 24 kWh", years: "2011–2016", connectors: ["CHAdeMO", "Type 2"], maxDcKw: 46, maxAcKw: 3.6,
    params: { ...base, massKg: 1546, cd: 0.28, frontalAreaM2: 2.33, usableKWh: 22, dcCurve: [[0, 40], [22, 46], [100, 10]] } },
  { id: "nissan-leaf-40", make: "Nissan", model: "Leaf 40 kWh", years: "2018–2024", connectors: ["CHAdeMO", "Type 2"], maxDcKw: 45, maxAcKw: 6.6,
    params: { ...base, massKg: 1632, cd: 0.28, frontalAreaM2: 2.37, usableKWh: 38, dcCurve: [[0, 41], [62, 45], [65, 36], [100, 15]] } },
  { id: "tesla-model-3-sr", make: "Tesla", model: "Model 3 Standard Range", years: "2019–2023", connectors: ["CCS", "NACS"], maxDcKw: 149, maxAcKw: 11,
    params: { ...base, massKg: 1686, cd: 0.23, frontalAreaM2: 2.27, usableKWh: 50, dcCurve: [[0, 130], [52, 149], [60, 110], [100, 12]] } },
  { id: "tesla-model-y-lr", make: "Tesla", model: "Model Y Long Range", years: "2020–2024", connectors: ["CCS", "NACS"], maxDcKw: 246, maxAcKw: 11,
    params: { ...base, massKg: 2054, cd: 0.23, frontalAreaM2: 2.65, usableKWh: 72.5, dcCurve: [[0, 246], [35, 238], [75, 99], [100, 18]] } },
  { id: "chevrolet-bolt", make: "Chevrolet", model: "Bolt EV 66 kWh", years: "2020–2023", connectors: ["CCS", "Type 2"], maxDcKw: 55, maxAcKw: 7.2,
    params: { ...base, massKg: 1691, cd: 0.308, frontalAreaM2: 2.39, usableKWh: 66, dcCurve: [[0, 55], [56, 38], [68, 24], [85, 16], [100, 7]] } },
  { id: "kia-niro-ev-64", make: "Kia", model: "Niro EV 64 kWh", years: "2019–2022", connectors: ["CCS", "Type 2"], maxDcKw: 77, maxAcKw: 7.2,
    params: { ...base, massKg: 1823, cd: 0.29, frontalAreaM2: 2.41, usableKWh: 64,
      dcCurve: [[0, 70], [40, 77], [42, 70], [53, 71], [55, 57], [71, 58], [72, 38], [76, 38], [78, 25], [88, 25], [100, 8]] } },
  { id: "vw-id4-77", make: "Volkswagen", model: "ID.4 77 kWh", years: "2021–2024", connectors: ["CCS", "Type 2"], maxDcKw: 135, maxAcKw: 11,
    params: { ...base, massKg: 2124, cd: 0.28, frontalAreaM2: 2.57, usableKWh: 77,
      dcCurve: [[0, 115], [15, 135], [30, 135], [50, 110], [70, 70], [80, 50], [100, 25]] } },
];

export function findVehicle(id: string): VehicleModel | undefined {
  return VEHICLE_CATALOG.find((v) => v.id === id);
}

/** Параметри з урахуванням стану батареї: для вживаного автомобіля доступна ємність менша за паспортну */
export function withStateOfHealth(p: VehicleParams, sohPct: number): VehicleParams {
  const soh = Math.min(Math.max(sohPct, num("sohMinPct")), 100) / 100;
  return { ...p, usableKWh: p.usableKWh * soh };
}
