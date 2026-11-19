// Коефіцієнт непрямолінійності доріг κ = дорожня відстань / відстань по великому колу.
// Дані: матриця OSRM 22×22 обласних центрів (data/osrm_ua_cities.json, OpenStreetMap, ODbL).
// Запуск: node --experimental-strip-types --no-warnings research/params/circuity.ts → results/circuity.json
import { readFileSync, writeFileSync } from "node:fs";
import { UA_CITIES as CITIES } from "../../lib/energy/src/places.ts";
import { haversineKm } from "../../lib/energy/src/stations.ts";

const here = new URL(".", import.meta.url).pathname;
const m = JSON.parse(readFileSync(here + "data/osrm_ua_cities.json", "utf8"));
const pos = (id: string) => { const c = CITIES.find((x) => x.id === id); if (!c) throw new Error(id); return c; };
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i)); };
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const all: number[] = [], mid: number[] = [], kmh: number[] = [];
m.cities.forEach((a: string, i: number) => m.cities.forEach((b: string, j: number) => {
  if (i === j) return;
  const gc = haversineKm(pos(a).lat, pos(a).lon, pos(b).lat, pos(b).lon);
  const k = m.distance_m[i][j] / 1000 / gc;
  all.push(k);
  if (gc >= 120 && gc <= 480) mid.push(k); // відстані між сусідніми зарядками на маршрутах
  kmh.push(m.distance_m[i][j] / m.duration_s[i][j] * 3.6); // середня швидкість маршруту OSRM (довідково)
}));
const stat = (xs: number[]) => ({ n: xs.length, median: r3(q(xs, 0.5)), q25: r3(q(xs, 0.25)), q75: r3(q(xs, 0.75)) });
const out = { source: m.source, retrieved: m.retrieved, all_pairs: stat(all), pairs_120_480km: stat(mid),
  osrm_speed_kmh: stat(kmh) };
writeFileSync(here + "results/circuity.json", JSON.stringify(out, null, 1) + "\n");
console.log(out);
