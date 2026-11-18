// Висоти міст довідника і зарядних станцій над рівнем моря з цифрової моделі рельєфу Copernicus DEM GLO-90
// (DOI 10.5270/ESA-c5d3d65) через Elevation API Open-Meteo: до 100 точок за запит.
// Запуск (потрібен доступ до api.open-meteo.com):
//   node --experimental-strip-types --no-warnings research/stations/elevation.ts
// Результат: research/stations/data/elevations.json і поле elevM у ua_stations.json (обидві копії);
// висоти міст переносяться в lib/energy/src/places.ts вручну за файлом elevations.json.
import { readFileSync, writeFileSync } from "node:fs";
import { UA_CITIES } from "../../lib/energy/src/places.ts";

const root = new URL("../../", import.meta.url).pathname;
const STATION_FILES = [`${root}research/stations/data/ua_stations.json`, `${root}artifacts/api-server/src/data/ua_stations.json`];
const stations: { id: number; lat: number; lon: number; elevM?: number }[] = JSON.parse(readFileSync(STATION_FILES[0], "utf8"));
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const points = [
  ...UA_CITIES.map((c) => ({ id: `c:${c.id}`, lat: r4(c.lat), lon: r4(c.lon) })),
  ...stations.map((s) => ({ id: `s:${s.id}`, lat: r4(s.lat), lon: r4(s.lon) })),
];

const elev: number[] = [];
for (let i = 0; i < points.length; i += 100) {
  const chunk = points.slice(i, i + 100);
  const q = new URLSearchParams({ latitude: chunk.map((p) => p.lat).join(","), longitude: chunk.map((p) => p.lon).join(",") });
  const r = await fetch(`https://api.open-meteo.com/v1/elevation?${q}`);
  const j = (await r.json()) as { elevation?: number[]; reason?: string };
  if (!j.elevation || j.elevation.length !== chunk.length) throw new Error(j.reason ?? "unexpected response");
  elev.push(...j.elevation);
  await new Promise((res) => setTimeout(res, 300));
}

const byId = new Map(points.map((p, i) => [p.id, elev[i]]));
writeFileSync(`${root}research/stations/data/elevations.json`, JSON.stringify({
  source: "Copernicus DEM GLO-90 (2021), через Elevation API Open-Meteo (https://api.open-meteo.com/v1/elevation)",
  doi: "https://doi.org/10.5270/ESA-c5d3d65", retrieved: new Date().toISOString().slice(0, 10), script: "research/stations/elevation.ts",
  points: points.map((p, i) => ({ ...p, elevM: elev[i] })),
}, null, 1));
for (const f of STATION_FILES) {
  const list = JSON.parse(readFileSync(f, "utf8")) as typeof stations;
  for (const s of list) s.elevM = byId.get(`s:${s.id}`);
  writeFileSync(f, JSON.stringify(list, null, 1));
}
console.log(`${points.length} точок; міста:`, UA_CITIES.map((c) => `${c.id} ${byId.get(`c:${c.id}`)}`).join(", "));
