// Погода з відкритого сервісу Open-Meteo (open-meteo.com): температура повітря і вітер на задану годину.
// Для минулих дат спершу архів реаналізу ERA5, для майбутніх і найближчих – годинний прогноз (до 16 діб уперед);
// якщо одне джерело не має значення, береться інше. Відповіді кешуються в пам'яті; якщо сервіс недоступний,
// функції повертають null, а розрахунок продовжується з температурою, вказаною вручну.
// Висоти міст і станцій зберігаються в даних (Copernicus DEM, research/stations/elevation.ts) і тут не запитуються.
import { bearingDeg, haversineKm, headWindComponent, meanWind, num, type Wind } from "@workspace/energy";
import { logger } from "./logger.js";

const forecastBase = () => (process.env.OPEN_METEO_URL ?? "https://api.open-meteo.com").replace(/\/$/, "");
const archiveBase = () => (process.env.OPEN_METEO_ARCHIVE_URL ?? "https://archive-api.open-meteo.com").replace(/\/$/, "");
const TIMEOUT_MS = 6000;
const DAY = 86400000;
const FORECAST_DAYS = 15;          // горизонт прогнозу сервісу – 16 діб, з них остання може бути неповною
const ARCHIVE_AFTER_DAYS = 2;      // архів ERA5 доступний із затримкою; давніші години беруться з нього
// після збою сервіс не опитується кілька хвилин, щоб розрахунок маршруту не чекав на тайм-аут при кожному запиті
const PAUSE_MS = 5 * 60000;
let pausedUntil = 0;

async function getJson<T>(url: string): Promise<T> {
  if (Date.now() < pausedUntil) throw new Error("Open-Meteo paused after a failure");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    pausedUntil = Date.now() + PAUSE_MS;
    throw e;
  } finally { clearTimeout(timer); }
}

export interface Weather {
  time: string;          // година, UTC
  tempC: number;         // температура повітря на висоті 2 м
  windMs: number;        // швидкість вітру на висоті 10 м
  windFromDeg: number;   // напрямок, звідки дме вітер (0 – з півночі, 90 – зі сходу)
  source: "forecast" | "archive";
}

interface HourlyResponse { hourly?: { time: string[]; temperature_2m: (number | null)[]; wind_speed_10m: (number | null)[]; wind_direction_10m: (number | null)[] } }

const weatherCache = new Map<string, { at: number; value: Promise<Weather | null> }>();

/** Погода в точці на задану годину (округлюється до найближчої години) */
export function weatherAt(lat: number, lon: number, when: Date): Promise<Weather | null> {
  const hour = new Date(Math.round(when.getTime() / 3600000) * 3600000);
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${hour.toISOString()}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60000) return hit.value;
  const value = fetchWeather(lat, lon, hour).catch((e: Error) => { logger.warn({ err: e.message }, "weather unavailable"); return null; });
  weatherCache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchWeather(lat: number, lon: number, hour: Date): Promise<Weather | null> {
  const age = Date.now() - hour.getTime();
  if (age < -FORECAST_DAYS * DAY) return null;                     // далі за горизонт прогнозу
  const order: Weather["source"][] = age > ARCHIVE_AFTER_DAYS * DAY ? ["archive", "forecast"] : ["forecast", "archive"];
  for (const source of order) {
    const w = await fetchFrom(source, lat, lon, hour);
    if (w) return w;
  }
  return null;
}

async function fetchFrom(source: Weather["source"], lat: number, lon: number, hour: Date): Promise<Weather | null> {
  const day = hour.toISOString().slice(0, 10);
  const q = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), hourly: "temperature_2m,wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "ms", timezone: "GMT", start_date: day, end_date: day });
  const url = source === "archive" ? `${archiveBase()}/v1/archive?${q}` : `${forecastBase()}/v1/forecast?${q}`;
  const h = (await getJson<HourlyResponse>(url)).hourly;
  if (!h) return null;
  const target = hour.toISOString().slice(0, 13);
  const i = h.time.findIndex((t) => t.slice(0, 13) === target);
  if (i < 0 || h.temperature_2m[i] == null) return null;
  return { time: `${h.time[i]}Z`, tempC: h.temperature_2m[i]!, windMs: h.wind_speed_10m[i] ?? 0, windFromDeg: h.wind_direction_10m[i] ?? 0, source };
}

const toWind = (w: Weather): Wind => ({ speedMs: w.windMs, fromDeg: w.windFromDeg });

/** Умови поїздки між двома пунктами: погода на виїзді й на прибутті, середня температура і середній вектор вітру */
export async function tripWeather(from: { lat: number; lon: number }, to: { lat: number; lon: number }, departure: Date) {
  const arrival = new Date(departure.getTime() + roughDriveHours(from, to) * 3600000);
  const [a, b] = await Promise.all([weatherAt(from.lat, from.lon, departure), weatherAt(to.lat, to.lon, arrival)]);
  if (!a || !b) return null;
  const wind = meanWind([toWind(a), toWind(b)]);
  const brg = bearingDeg(from, to);
  return { from: a, to: b, tempC: (a.tempC + b.tempC) / 2, wind, bearingDeg: brg, headWindMs: headWindComponent(wind, brg) };
}

/** Орієнтовний час у дорозі для вибору години прогнозу в пункті призначення: відстань графа коридору на швидкості міжміських ребер */
export const roughDriveHours = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  (haversineKm(a.lat, a.lon, b.lat, b.lon) * num("circuity")) / num("edgeSpeedHighway");

/** Для тестів: скинути кеш і паузу після збою */
export function resetOpenMeteo() { weatherCache.clear(); pausedUntil = 0; }
