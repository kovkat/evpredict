// Фізична (поздовжньо-динамічна) модель енергоспоживання електромобіля
import { num, list } from "./params.ts";
export interface VehicleParams {
  massKg: number;          // маса автомобіля з водієм, кг
  cd: number;              // коефіцієнт аеродинамічного опору
  frontalAreaM2: number;   // площа міделя, м²
  crr: number;             // коефіцієнт опору коченню
  drivetrainEff: number;   // ККД тягового ланцюга (батарея → колесо)
  regenEff: number;        // ККД рекуперації (колесо → батарея)
  auxBaseW: number;        // базове навантаження допоміжних систем, Вт
  hvacWPerDeg: number;     // приріст потужності HVAC на 1 °C відхилення від комфорту, Вт/°C
  usableKWh: number;       // корисна ємність батареї, кВт·год
}

export interface Segment {
  lengthM: number;   // довжина ділянки, м
  speedMs: number;   // середня швидкість руху, м/с
  gradePct: number;  // ухил дороги, %
  tempC: number;     // температура повітря, °C
  headWindMs?: number; // зустрічний вітер, м/с
  accelMs2?: number; // середнє додатне прискорення (для міських ділянок), м/с²
  stopsPerKm?: number; // кількість зупинок на 1 км
}

const G = num("g");
const T_COMFORT = num("comfortTemp");

export const airDensity = (tempC: number, pressurePa = num("airPressure")) =>
  pressurePa / (num("airGasConstant") * (tempC + 273.15));

/** Енергія руху ділянкою, Вт·год (від'ємне значення — рекуперація) */
export function segmentEnergyWh(p: VehicleParams, s: Segment) {
  const theta = Math.atan(s.gradePct / 100);
  const vRel = s.speedMs + (s.headWindMs ?? 0);
  const rho = airDensity(s.tempC);
  const fRoll = p.crr * p.massKg * G * Math.cos(theta);
  const fGrade = p.massKg * G * Math.sin(theta);
  const fAero = 0.5 * rho * p.cd * p.frontalAreaM2 * vRel * Math.abs(vRel);
  const fTotal = fRoll + fGrade + fAero;
  const wheelJ = fTotal * s.lengthM;
  let batteryJ = wheelJ >= 0 ? wheelJ / p.drivetrainEff : wheelJ * p.regenEff;
  // втрати на розгін після зупинок: кінетична енергія, частково повернута рекуперацією
  const stops = (s.stopsPerKm ?? 0) * (s.lengthM / 1000);
  if (stops > 0) {
    const kinJ = 0.5 * p.massKg * s.speedMs ** 2;
    batteryJ += stops * (kinJ / p.drivetrainEff - kinJ * p.regenEff);
  }
  const timeS = s.lengthM / s.speedMs;
  const auxW = p.auxBaseW + p.hvacWPerDeg * Math.abs(s.tempC - T_COMFORT);
  batteryJ += auxW * timeS;
  return {
    energyWh: batteryJ / 3600,
    timeS,
    components: {
      rollWh: (fRoll * s.lengthM) / p.drivetrainEff / 3600,
      gradeWh: (fGrade * s.lengthM) / 3600,
      aeroWh: (fAero * s.lengthM) / p.drivetrainEff / 3600,
      auxWh: (auxW * timeS) / 3600,
    },
  };
}

/** Персоналізаційний коефіцієнт: експоненційно зважене середнє відношення факт/прогноз */
export function updatePersonalFactor(k: number, actualWh: number, predictedWh: number, alpha = num("ewmaAlpha")) {
  if (predictedWh <= 0) return k;
  const [lo, hi] = list("ratioClip");
  const ratio = Math.min(Math.max(actualWh / predictedWh, lo), hi);
  return (1 - alpha) * k + alpha * ratio;
}
