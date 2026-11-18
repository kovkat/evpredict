// Довідник моделей електромобілів, поширених в Україні.
// Значення наближені за відкритими технічними характеристиками і мають уточнюватися:
// маса включає водія (+80 кг), usableKWh — корисна (а не номінальна) ємність батареї.
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
    params: { ...base, massKg: 1430, cd: 0.311, frontalAreaM2: 2.0, crr: 0.009, usableKWh: 22 } },
  { id: "nissan-leaf-24", make: "Nissan", model: "Leaf 24 kWh", years: "2011–2016", connectors: ["CHAdeMO", "Type 2"], maxDcKw: 50, maxAcKw: 3.6,
    params: { ...base, massKg: 1600, cd: 0.29, frontalAreaM2: 2.27, usableKWh: 21 } },
  { id: "nissan-leaf-40", make: "Nissan", model: "Leaf 40 kWh", years: "2018–2024", connectors: ["CHAdeMO", "Type 2"], maxDcKw: 50, maxAcKw: 6.6,
    params: { ...base, massKg: 1660, cd: 0.28, frontalAreaM2: 2.27, usableKWh: 39 } },
  { id: "tesla-model-3-sr", make: "Tesla", model: "Model 3 Standard Range", years: "2019–2023", connectors: ["CCS", "NACS"], maxDcKw: 170, maxAcKw: 11,
    params: { ...base, massKg: 1690, cd: 0.23, frontalAreaM2: 2.22, crr: 0.009, drivetrainEff: 0.9, hvacWPerDeg: 40, usableKWh: 54 } },
  { id: "tesla-model-y-lr", make: "Tesla", model: "Model Y Long Range", years: "2020–2024", connectors: ["CCS", "NACS"], maxDcKw: 250, maxAcKw: 11,
    params: { ...base, massKg: 2060, cd: 0.23, frontalAreaM2: 2.66, crr: 0.009, drivetrainEff: 0.9, hvacWPerDeg: 40, usableKWh: 75 } },
  { id: "chevrolet-bolt", make: "Chevrolet", model: "Bolt EV", years: "2017–2023", connectors: ["CCS", "Type 2"], maxDcKw: 55, maxAcKw: 7.2,
    params: { ...base, massKg: 1700, cd: 0.308, frontalAreaM2: 2.34, usableKWh: 65 } },
  { id: "kia-niro-ev-64", make: "Kia", model: "Niro EV 64 kWh", years: "2019–2022", connectors: ["CCS", "Type 2"], maxDcKw: 77, maxAcKw: 7.2,
    params: { ...base, massKg: 1840, cd: 0.29, frontalAreaM2: 2.4, usableKWh: 64 } },
  { id: "vw-id4-77", make: "Volkswagen", model: "ID.4 77 kWh", years: "2021–2024", connectors: ["CCS", "Type 2"], maxDcKw: 135, maxAcKw: 11,
    params: { ...base, massKg: 2200, cd: 0.28, frontalAreaM2: 2.6, drivetrainEff: 0.89, usableKWh: 77 } },
];

export function findVehicle(id: string): VehicleModel | undefined {
  return VEHICLE_CATALOG.find((v) => v.id === id);
}

/** Параметри з урахуванням стану батареї: для вживаного автомобіля доступна ємність менша за паспортну */
export function withStateOfHealth(p: VehicleParams, sohPct: number): VehicleParams {
  const soh = Math.min(Math.max(sohPct, num("sohMinPct")), 100) / 100;
  return { ...p, usableKWh: p.usableKWh * soh };
}
