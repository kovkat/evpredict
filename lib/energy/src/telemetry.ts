// Підсистема отримання телеметрії: уніфікований інтерфейс джерела та програмний симулятор поїздок
import { type VehicleParams, airDensity } from "./physics.ts";
import { createRng } from "./rng.ts";

export interface TelemetrySample {
  t: number;          // час від початку поїздки, с
  distanceM: number;  // пройдена відстань, м
  speedKmh: number;   // швидкість, км/год
  accelMs2: number;   // прискорення, м/с²
  elevM: number;      // висота, м
  tempC: number;      // температура повітря, °C
  powerKw: number;    // потужність на клемах батареї (від'ємна — рекуперація), кВт
  socPct: number;     // рівень заряду, %
}

/** Уніфікований інтерфейс джерела телеметрії. Нові джерела (наприклад, Bluetooth OBD-II)
 *  додаються як нові реалізації без зміни моделей прогнозування та маршрутизації. */
export interface TelemetrySource {
  readonly kind: "manual" | "simulator" | "dataset" | "bluetooth-obd";
  samples(): Iterable<TelemetrySample>;
}

export interface SimSegment { lengthKm: number; targetKmh: number; gradePct: number; stopsPerKm: number; }
export interface SimOptions {
  tempC: number; socStartPct: number; seed: number;
  style: number;        // стиль водіння: 0 — спокійний, 1 — звичайний, 2 — агресивний
  speedNoiseKmh: number; // шум вимірювання швидкості
}

export class SimulatedTripSource implements TelemetrySource {
  readonly kind = "simulator" as const;
  private p: VehicleParams; private route: SimSegment[]; private o: SimOptions;
  constructor(p: VehicleParams, route: SimSegment[], o: SimOptions) { this.p = p; this.route = route; this.o = o; }

  *samples(): Iterable<TelemetrySample> {
    const { p, o } = this; const rand = createRng(o.seed).next; const G = 9.81;
    const accMax = 0.8 + 0.6 * o.style;            // інтенсивність розгону, м/с²
    const decMax = 1.2 + 0.8 * o.style;            // інтенсивність гальмування, м/с²
    const overSpeed = 1 + 0.05 * (o.style - 1);    // відхилення крейсерської швидкості
    let t = 0, x = 0, v = 0, elev = 150, soc = o.socStartPct, wait = 0;
    const rho = airDensity(o.tempC);
    const auxW = p.auxBaseW + p.hvacWPerDeg * Math.abs(o.tempC - 21);
    for (const seg of this.route) {
      const segEnd = x + seg.lengthKm * 1000; const theta = Math.atan(seg.gradePct / 100);
      const vCruise = (seg.targetKmh * overSpeed) / 3.6;
      let nextStop = x + (seg.stopsPerKm > 0 ? (-Math.log(1 - rand()) / seg.stopsPerKm) * 1000 : Infinity);
      while (x < segEnd) {
        let a: number;
        if (wait > 0) { a = 0; v = 0; wait--; }
        else {
          const brakeDist = (v * v) / (2 * decMax);
          if (nextStop - x <= brakeDist + 1) {
            a = -decMax;
            if (v + a <= 0) { a = -v; wait = Math.round(10 + 20 * rand());
              nextStop = x + (-Math.log(1 - rand()) / seg.stopsPerKm) * 1000; }
          } else a = v < vCruise ? Math.min(accMax, vCruise - v) : Math.max(-0.5, vCruise - v);
        }
        const vNew = Math.max(0, v + a); const vAvg = (v + vNew) / 2; const dx = vAvg;
        const rollAndGrade = (u: number) => u > 0 ? p.massKg * G * (p.crr * Math.cos(theta) + Math.sin(theta)) : 0;
        const f = p.massKg * a + rollAndGrade(vAvg) + 0.5 * rho * p.cd * p.frontalAreaM2 * vAvg ** 2;
        const wheelW = f * vAvg;
        const battW = (wheelW >= 0 ? wheelW / p.drivetrainEff : wheelW * p.regenEff) + auxW;
        soc -= (battW / 3600 / (p.usableKWh * 1000)) * 100;
        x += dx; elev += dx * Math.sin(theta); v = vNew; t += 1;
        const noisy = (kmh: number) => Math.max(0, kmh + (rand() - 0.5) * 2 * o.speedNoiseKmh);
        yield { t, distanceM: x, speedKmh: noisy(vAvg * 3.6), accelMs2: a, elevM: elev, tempC: o.tempC,
                powerKw: battW / 1000, socPct: Math.min(100, soc) };
      }
    }
  }
}

/** Ручне введення: лише SoC на початку і в кінці поїздки та відстань */
export class ManualEntrySource implements TelemetrySource {
  readonly kind = "manual" as const;
  private start: TelemetrySample; private end: TelemetrySample;
  constructor(start: TelemetrySample, end: TelemetrySample) { this.start = start; this.end = end; }
  *samples() { yield this.start; yield this.end; }
}

export function summarize(src: TelemetrySource, usableKWh: number) {
  let first: TelemetrySample | undefined, last: TelemetrySample | undefined, eWh = 0, n = 0;
  for (const s of src.samples()) { if (!first) first = s; eWh += s.powerKw * 1000 / 3600; last = s; n++; }
  return { samples: n, km: last!.distanceM / 1000, minutes: last!.t / 60,
           energyKWh: eWh / 1000, socDrop: first!.socPct - last!.socPct,
           whPerKm: eWh / (last!.distanceM / 1000), usableKWh };
}
