// Пояснення персонального прогнозу точними значеннями Шеплі.
// Прогноз розкладається на внески п'яти зрозумілих водієві чинників відносно еталонних умов:
// 70 км/год, +20 °C, рівна дорога, без зупинок, «модельний» водій (k = 1).
import type { VehicleParams } from "./physics.ts";
import { segmentEnergyWh } from "./physics.ts";
import { type TripInput, reliefEnergyWh } from "./trip.ts";
import { num } from "./params.ts";

export type Factor = "speed" | "weather" | "relief" | "stops" | "personal";
export const FACTORS: Factor[] = ["speed", "weather", "relief", "stops", "personal"];
export const REFERENCE = { speedKmh: num("referenceSpeed"), tempC: num("referenceTemp"), stopsPerKm: 0 } as const;

/** Енергія поїздки, у якій чинники з множини `on` мають фактичні значення, а решта — еталонні */
export function energyWithFactors(p: VehicleParams, t: TripInput, on: ReadonlySet<Factor>, k: number) {
  let e = 0;
  for (const part of t.parts) {
    if (part.km <= 0) continue;
    e += segmentEnergyWh(p, {
      lengthM: part.km * 1000,
      speedMs: (on.has("speed") ? part.speedKmh : REFERENCE.speedKmh) / 3.6,
      gradePct: 0,
      tempC: on.has("weather") ? t.tempC : REFERENCE.tempC,
      headWindMs: on.has("weather") ? t.headWindMs : 0,
      stopsPerKm: on.has("stops") ? part.stopsPerKm : REFERENCE.stopsPerKm,
    }).energyWh;
  }
  if (on.has("relief")) e += reliefEnergyWh(p, t.elevGainM, t.elevLossM);
  return on.has("personal") ? e * k : e;
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

export interface Explanation {
  baseWh: number;                    // енергія в еталонних умовах
  predWh: number;                    // повний прогноз
  phi: Record<Factor, number>;       // внески чинників, Вт·год; baseWh + Σphi = predWh
}

/** Точні значення Шеплі: перебір усіх 2^5 = 32 коаліцій чинників */
export function explainShapley(p: VehicleParams, t: TripInput, k: number): Explanation {
  const n = FACTORS.length;
  const cache = new Map<number, number>();
  const value = (mask: number) => {
    let v = cache.get(mask);
    if (v === undefined) {
      v = energyWithFactors(p, t, new Set(FACTORS.filter((_, i) => mask & (1 << i))), k);
      cache.set(mask, v);
    }
    return v;
  };
  const phi = { speed: 0, weather: 0, relief: 0, stops: 0, personal: 0 } as Record<Factor, number>;
  for (let mask = 0; mask < 1 << n; mask++) {
    let size = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) size++;
    const w = (factorial(size) * factorial(n - size - 1)) / factorial(n);
    FACTORS.forEach((f, i) => {
      if (!(mask & (1 << i))) phi[f] += w * (value(mask | (1 << i)) - value(mask));
    });
  }
  return { baseWh: value(0), predWh: value((1 << n) - 1), phi };
}

const NAMES: Record<"uk" | "en", Record<Factor, string>> = {
  uk: { speed: "швидкість", weather: "погода (температура, вітер)", relief: "рельєф", stops: "розгони після зупинок", personal: "ваш стиль водіння" },
  en: { speed: "Speed", weather: "Weather (temperature, wind)", relief: "Elevation", stops: "Stop-and-go", personal: "Your driving style" },
};
export const factorName = (f: Factor, lang: "uk" | "en" = "en") => NAMES[lang][f];

/** Текстове пояснення 2–3 найбільших внесків, сформоване лише з фактичних чисел розрахунку */
export function explanationText(ex: Explanation, t: TripInput, k: number, usableKWh: number, lang: "uk" | "en" = "en"): string[] {
  const kwh = (wh: number) => (Math.abs(wh) / 1000).toFixed(1);
  const pp = (wh: number) => ((Math.abs(wh) / (usableKWh * 1000)) * 100).toFixed(0);
  const top = FACTORS.map((f) => ({ f, v: ex.phi[f] }))
    .filter((x) => Math.abs(x.v) >= 0.03 * ex.predWh && Math.abs(x.v) >= 50)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 3);
  const maxSpeed = Math.max(...t.parts.filter((p) => p.km > 0).map((p) => p.speedKmh));
  const out: string[] = [];
  for (const { f, v } of top) {
    const more = v > 0;
    if (lang === "uk") {
      const tc = String(t.tempC).replace("-", "−").replace(".", ",");   // типографський мінус і десяткова кома
      const plural = f === "stops";   // «розгони» — множина
      const verb = more ? `${plural ? "додають" : "додає"} ${kwh(v).replace(".", ",")} кВт·год (${pp(v)} % заряду)`
        : `${plural ? "заощаджують" : "заощаджує"} ${kwh(v).replace(".", ",")} кВт·год (${pp(v)} % заряду)`;
      const why: Record<Factor, string> = {
        speed: more ? `на ${maxSpeed} км/год аеродинамічний опір значно більший, ніж на 70 км/год` : "повільний рух зменшує аеродинамічний опір",
        weather: t.tempC < 15 ? `при ${tc} °C енергія йде на обігрів салону і батареї` : t.tempC > 25 ? `при ${tc} °C працює кондиціонер` : "погодні умови близькі до комфортних",
        relief: more ? `набір висоти ${t.elevGainM} м лише частково повертається на спусках` : "спусків більше, ніж підйомів, і рекуперація повертає енергію",
        stops: "кожен розгін після світлофора витрачає енергію, яку рекуперація повертає лише частково",
        personal: more ? `за історією ваших поїздок ви витрачаєте в середньому на ${((k - 1) * 100).toFixed(0)} % більше за модельного водія` : `за історією ваших поїздок ви їздите на ${((1 - k) * 100).toFixed(0)} % економніше за модельного водія`,
      };
      out.push(`${NAMES.uk[f][0].toUpperCase() + NAMES.uk[f].slice(1)} ${verb}: ${why[f]}.`);
    } else {
      const verb = more ? `adds ${kwh(v)} kWh (${pp(v)} % of the battery)` : `saves ${kwh(v)} kWh (${pp(v)} % of the battery)`;
      const why: Record<Factor, string> = {
        speed: more ? `at ${maxSpeed} km/h aerodynamic drag is much higher than at 70 km/h` : "slower driving reduces aerodynamic drag",
        weather: t.tempC < 15 ? `at ${t.tempC} °C energy goes to heating the cabin and battery` : t.tempC > 25 ? `at ${t.tempC} °C the air conditioning is running` : "weather is close to comfortable",
        relief: more ? `${t.elevGainM} m of climbing is only partly recovered on descents` : "there is more descent than climbing and regeneration recovers energy",
        stops: "every acceleration after a stop costs energy that regeneration only partly recovers",
        personal: more ? `based on your trip history you use ${((k - 1) * 100).toFixed(0)} % more than the model driver` : `based on your trip history you drive ${((1 - k) * 100).toFixed(0)} % more efficiently than the model driver`,
      };
      out.push(`${NAMES.en[f]} ${verb}: ${why[f]}.`);
    }
  }
  return out;
}
