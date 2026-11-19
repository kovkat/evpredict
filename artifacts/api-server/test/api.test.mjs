// HTTP-тести серверної частини (запускаються після збирання: pnpm --filter @workspace/api-server test)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { startFakeOpenMeteo, fakeTemp } from "./fake-open-meteo.mjs";

let server, base, meteo, api;
before(async () => {
  process.env.PGLITE_DIR = "memory";
  delete process.env.DATABASE_URL;
  meteo = await startFakeOpenMeteo();
  process.env.OPEN_METEO_URL = meteo.url;
  process.env.OPEN_METEO_ARCHIVE_URL = meteo.url;
  // за замовчуванням тестується зібраний сервер; API_ENTRY=../src/index.ts – вихідний код (для звіту покриття)
  api = await import(process.env.API_ENTRY ?? "../dist/index.mjs");
  const app = api.default;
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server?.close(); meteo?.close(); });

const post = (path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const trip = { parts: [{ type: "city", km: 8, speedKmh: 35, stopsPerKm: 1.5 }, { type: "highway", km: 70, speedKmh: 110, stopsPerKm: 0 }], tempC: -5, elevGainM: 350, elevLossM: 260 };

test("healthz", async () => {
  const r = await fetch(base + "/healthz");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "ok" });
});

test("каталог автомобілів", async () => {
  const list = await (await fetch(base + "/vehicles/catalog")).json();
  assert.ok(list.length >= 8 && list.every((v) => v.id && v.usableKWh > 0));
});

test("прогноз з поясненням", async () => {
  const r = await post("/forecast", { vehicleId: "fiat-500e-2013", trip, socStartPct: 90, personalFactor: 1.1, lang: "uk" });
  assert.equal(r.status, 200);
  const f = await r.json();
  const sum = f.contributions.reduce((s, c) => s + c.kWh, 0);
  assert.ok(Math.abs(f.baseKWh + sum - f.energyKWh) < 1e-6);
  assert.ok(f.whatIf.length >= 2);
});

test("прогноз: SoH зменшує доступну ємність і збільшує витрату заряду у %", async () => {
  const a = await (await post("/forecast", { vehicleId: "nissan-leaf-40", trip, socStartPct: 90 })).json();
  const b = await (await post("/forecast", { vehicleId: "nissan-leaf-40", sohPct: 75, trip, socStartPct: 90 })).json();
  assert.ok(Math.abs(a.energyKWh - b.energyKWh) < 1e-9 && b.socUsedPct > a.socUsedPct);
});

test("прогноз: некоректні дані → 400, невідомий автомобіль → 404", async () => {
  assert.equal((await post("/forecast", { vehicleId: "fiat-500e-2013", trip: { ...trip, tempC: 90 }, socStartPct: 90 })).status, 400);
  assert.equal((await post("/forecast", { vehicleId: "fiat-500e-2013", trip: { ...trip, parts: [] }, socStartPct: 90 })).status, 400);
  assert.equal((await post("/forecast", { vehicleId: "nope", trip, socStartPct: 90 })).status, 404);
});

test("симулятор і персоналізація", async () => {
  const trips = await (await post("/simulator/trips", { vehicleId: "fiat-500e-2013", profileId: "dynamic", count: 30, seed: 3 })).json();
  assert.equal(trips.length, 30);
  assert.ok(trips.every((t) => t.source === "simulator"));
  const r = await (await post("/personalization/replay", { vehicleId: "fiat-500e-2013", records: trips })).json();
  assert.equal(r.trips, 30);
  assert.ok(r.personalFactor > 1);
});

test("станції поблизу зі знімка реєстру з індексом надійності", async () => {
  const r = await (await fetch(base + "/stations/nearby?lat=50.45&lon=30.52&radiusKm=10&dcOnly=1")).json();
  assert.ok(r.stations.length > 5 && r.stations.every((s) => s.dc && s.distanceKm <= 10 && s.reliabilityPct >= 0 && s.reliabilityPct <= 100));
  assert.ok(r.stations.every((s, i, a) => i === 0 || a[i - 1].distanceKm <= s.distanceKm));
  assert.equal((await fetch(base + "/stations/nearby?lat=10&lon=30")).status, 400);
});

test("маршрут між містами: список міст і знімок станцій", async () => {
  const r = await (await fetch(base + "/route/cities")).json();
  assert.ok(r.cities.length >= 20 && r.stations > 500);
});

test("маршрут Київ → Одеса: EVPredict прибуває з резервом, план порівнюється з базовим", async () => {
  const res = await post("/route/plan", { vehicleId: "kia-niro-ev-64", sohPct: 90, fromId: "kyiv", toId: "odesa", socStartPct: 90, reservePct: 10, tempC: 20, personalFactor: 1.1 });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.ok(r.evpredict.found && !r.evpredict.risky);
  assert.ok(r.evpredict.minSocPct >= 10 - 1e-6);
  assert.equal(r.evpredict.stops[0].kind, "origin");
  assert.equal(r.evpredict.stops.at(-1).kind, "destination");
  assert.ok(r.evpredict.stops.slice(1, -1).every((s) => s.chargeMinutes > 0 && s.reliabilityPct >= 50));
  assert.ok(r.baseline.found);
});

test("маршрут: помилки валідації", async () => {
  assert.equal((await post("/route/plan", { vehicleId: "kia-niro-ev-64", fromId: "kyiv", toId: "kyiv", socStartPct: 90, reservePct: 10, tempC: 20 })).status, 400);
  assert.equal((await post("/route/plan", { vehicleId: "kia-niro-ev-64", fromId: "kyiv", toId: "paris", socStartPct: 90, reservePct: 10, tempC: 20 })).status, 404);
  assert.equal((await post("/route/plan", { vehicleId: "kia-niro-ev-64", fromId: "kyiv", toId: "lviv", socStartPct: 8, reservePct: 10, tempC: 20 })).status, 400);
});

// ---------- облікові записи і дані в базі (вбудований PostgreSQL у пам'яті) ----------
const jar = () => {
  let cookie = "";
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return r;
  };
  return req;
};

test("реєстрація, вхід, вихід", async () => {
  const a = jar();
  assert.equal((await a("GET", "/auth/me")).status, 401);
  assert.equal((await a("POST", "/auth/register", { email: "x", password: "short" })).status, 400);
  const reg = await a("POST", "/auth/register", { email: "Test@Example.com", password: "correct horse", name: "Тест" });
  assert.equal(reg.status, 201);
  assert.equal((await reg.json()).user.email, "test@example.com");
  assert.equal((await a("POST", "/auth/register", { email: "test@example.com", password: "another one" })).status, 409);
  assert.equal((await (await a("GET", "/auth/me")).json()).user.name, "Тест");
  await a("POST", "/auth/logout");
  assert.equal((await a("GET", "/auth/me")).status, 401);
  assert.equal((await a("POST", "/auth/login", { email: "test@example.com", password: "wrong password" })).status, 401);
  assert.equal((await a("POST", "/auth/login", { email: "TEST@example.com", password: "correct horse" })).status, 200);
  assert.equal((await a("GET", "/auth/me")).status, 200);
});

test("дані користувача: автомобіль, історія, персональна модель, план маршруту, видалення", async () => {
  const a = jar(), b = jar();
  await a("POST", "/auth/register", { email: "driver@example.com", password: "12345678" });
  await b("POST", "/auth/register", { email: "other@example.com", password: "12345678" });
  assert.equal((await fetch(base + "/me/state")).status, 401);
  assert.equal((await a("PUT", "/me/vehicle", { vehicleId: "nope", sohPct: 90 })).status, 400);
  const v = await (await a("PUT", "/me/vehicle", { vehicleId: "nissan-leaf-40", sohPct: 88 })).json();
  assert.equal(v.vehicle.label, "Nissan Leaf 40 kWh");
  const recs = await (await post("/simulator/trips", { vehicleId: "nissan-leaf-40", sohPct: 88, profileId: "dynamic", count: 25, seed: 5 })).json();
  const put = await (await a("PUT", "/me/trips/nissan-leaf-40", { records: recs })).json();
  assert.equal(put.saved, 25);
  assert.ok(put.personalModel.k > 1 && put.personalModel.sigma >= 1);
  const st = await (await a("GET", "/me/state")).json();
  assert.equal(st.vehicle.vehicleId, "nissan-leaf-40");
  assert.equal(st.trips["nissan-leaf-40"].length, 25);
  assert.deepEqual(st.trips["nissan-leaf-40"].map((r) => r.id).sort(), recs.map((r) => r.id).sort());
  assert.equal(st.trips["nissan-leaf-40"].find((r) => r.id === recs[0].id).actualKWh, recs[0].actualKWh);
  // інший користувач не бачить чужих даних
  const other = await (await b("GET", "/me/state")).json();
  assert.equal(other.vehicle, null);
  assert.deepEqual(other.trips, {});
  // план маршруту зберігається в базі
  const saved = await a("POST", "/me/routes", { vehicleId: "nissan-leaf-40", sohPct: 88, fromId: "kyiv", toId: "zhytomyr", socStartPct: 90, reservePct: 10, tempC: 5 });
  assert.equal(saved.status, 201);
  const routes = await (await a("GET", "/me/routes")).json();
  assert.equal(routes.length, 1);
  assert.equal(routes[0].toCity, "zhytomyr");
  const exp = await (await a("GET", "/me/export")).json();
  assert.equal(exp.vehicles[0].trips.length, 25);
  // очищення історії і видалення облікового запису
  await a("PUT", "/me/trips/nissan-leaf-40", { records: [] });
  assert.equal((await (await a("GET", "/me/state")).json()).trips["nissan-leaf-40"].length, 0);
  assert.equal((await a("DELETE", "/me")).status, 200);
  assert.equal((await a("POST", "/auth/login", { email: "driver@example.com", password: "12345678" })).status, 401);
});

test("власні точки заряду: додавання, використання в плані лише власником, видалення", async () => {
  const a = jar(), b = jar();
  await a("POST", "/auth/register", { email: "own@example.com", password: "12345678" });
  await b("POST", "/auth/register", { email: "own2@example.com", password: "12345678" });
  assert.equal((await fetch(base + "/me/stations")).status, 401);
  assert.equal((await a("POST", "/me/stations", { title: "Дача", lat: 60, lon: 30, maxKw: 7, dc: false })).status, 400);
  assert.equal((await a("POST", "/me/stations", { title: "", lat: 50.35, lon: 29.6, maxKw: 7, dc: false })).status, 400);
  const created = await a("POST", "/me/stations", { title: "Дача", lat: 50.35, lon: 29.6, maxKw: 7.4, dc: false });
  assert.equal(created.status, 201);
  const own = await created.json();
  assert.deepEqual((await (await a("GET", "/me/stations")).json()).map((s) => s.title), ["Дача"]);
  assert.deepEqual(await (await b("GET", "/me/stations")).json(), []);
  // Fiat 500e без DC: Київ → Житомир (≈ 164 км) без власної точки неможливий, з нею – через неї
  const req = { vehicleId: "fiat-500e-2013", sohPct: 100, fromId: "kyiv", toId: "zhytomyr", socStartPct: 100, reservePct: 10, tempC: 15 };
  const anon = await (await post("/route/plan", req)).json();
  assert.equal(anon.evpredict.found, false);
  assert.equal(anon.ownStations, 0);
  const mine = await (await a("POST", "/route/plan", req)).json();
  assert.equal(mine.ownStations, 1);
  const stop = mine.evpredict.stops.find((s) => s.kind === "station");
  assert.ok(mine.evpredict.found && stop.own && stop.ac && stop.title === "Дача" && stop.maxKw === 6.6, JSON.stringify(stop));
  assert.equal((await (await b("POST", "/route/plan", req)).json()).evpredict.found, false);
  assert.equal((await a("POST", "/me/routes", req)).status, 201);
  assert.equal((await a("GET", "/me/export").then((r) => r.json())).ownStations[0].title, "Дача");
  // чужу точку видалити не можна
  assert.equal((await b("DELETE", `/me/stations/${own.id}`)).status, 404);
  assert.equal((await a("DELETE", `/me/stations/${own.id}`)).status, 200);
  assert.deepEqual(await (await a("GET", "/me/stations")).json(), []);
  assert.equal((await a("DELETE", "/me")).status, 200);
});

// ---------- погода (імітація Open-Meteo) і рельєф (висоти з даних) ----------
const day = 86400000;
const weather = (lat, lon, t) => fetch(`${base}/weather?lat=${lat}&lon=${lon}${t ? `&time=${new Date(t).toISOString()}` : ""}`);

test("погода: прогноз для найближчих годин, архів для минулих дат, за горизонтом прогнозу – 503", async () => {
  api.resetOpenMeteo();
  const now = await (await weather(50.45, 30.52)).json();
  assert.ok(Math.abs(now.tempC - fakeTemp(50.45)) < 1e-9 && now.windMs === 5 && now.windFromDeg === 270 && now.source === "forecast");
  assert.equal((await (await weather(50.45, 30.52, Date.now() - 10 * day)).json()).source, "archive");
  assert.equal((await weather(50.45, 30.52, Date.now() + 30 * day)).status, 503);
});

test("погода: якщо прогноз не має значення, береться архів; повторний запит – з кешу", async () => {
  api.resetOpenMeteo();
  const before = { ...meteo.calls };
  const w = await (await weather(65, 30)).json();
  assert.equal(w.source, "archive");
  assert.equal(meteo.calls.forecast - before.forecast, 1);
  assert.equal(meteo.calls.archive - before.archive, 1);
  await weather(65, 30);
  assert.equal(meteo.calls.forecast - before.forecast, 1);           // кеш
});

test("погода: після збою сервісу запити до нього призупиняються, решта API працює", async () => {
  api.resetOpenMeteo();
  assert.equal((await weather(85, 30)).status, 503);
  const calls = meteo.calls.forecast + meteo.calls.archive;
  assert.equal((await weather(50.1, 30.1)).status, 503);              // пауза: сервіс не опитується
  assert.equal(meteo.calls.forecast + meteo.calls.archive, calls);
  assert.equal((await post("/route/plan", { vehicleId: "kia-niro-ev-64", fromId: "kyiv", toId: "odesa", socStartPct: 90, reservePct: 10, tempC: 5, useWeather: true })).status, 200);
  api.resetOpenMeteo();
  assert.equal((await weather(50.1, 30.1)).status, 200);
});

const kyivLviv = { vehicleId: "kia-niro-ev-64", sohPct: 90, fromId: "kyiv", toId: "lviv", socStartPct: 90, reservePct: 10 };

test("маршрут з прогнозом погоди і рельєфом: на захід вітер зустрічний, Львів вище за Київ", async () => {
  api.resetOpenMeteo();
  const r = await (await post("/route/plan", { ...kyivLviv, useWeather: true })).json();
  const c = r.conditions;
  assert.ok(c.weatherAvailable && c.relief);
  assert.ok(Math.abs(c.tempC - (fakeTemp(50.4501) + fakeTemp(49.8397)) / 2) < 1e-6);
  assert.ok(c.headWindMs > 4.5 && c.headWindMs <= 5);
  assert.equal(c.fromElevM, 155);                                     // Copernicus DEM: Київ
  assert.equal(c.toElevM, 280);                                       // Львів
  assert.ok(r.evpredict.found && Math.abs(r.evpredict.climbM - r.evpredict.descentM - (c.toElevM - c.fromElevM)) < 1e-6);
  // у зворотний бік вітер попутний, спуск: енергії потрібно менше
  const back = await (await post("/route/plan", { ...kyivLviv, fromId: "lviv", toId: "kyiv", useWeather: true })).json();
  assert.ok(back.conditions.headWindMs < -4.5 && back.evpredict.energyKWh < r.evpredict.energyKWh);
});

test("маршрут: без прогнозу і без температури → 400; прогноз за горизонтом → ручна температура або 503; без рельєфу", async () => {
  api.resetOpenMeteo();
  assert.equal((await post("/route/plan", { ...kyivLviv })).status, 400);
  const far = new Date(Date.now() + 40 * day).toISOString();
  const manual = await (await post("/route/plan", { ...kyivLviv, useWeather: true, departure: far, tempC: 3 })).json();
  assert.ok(!manual.conditions.weatherAvailable && manual.conditions.tempC === 3 && manual.evpredict.found);
  assert.equal((await post("/route/plan", { ...kyivLviv, useWeather: true, departure: far })).status, 503);
  const flat = await (await post("/route/plan", { ...kyivLviv, tempC: 3, useRelief: false })).json();
  assert.ok(!flat.conditions.relief && flat.evpredict.climbM === 0 && flat.conditions.fromElevM === null);
});

// ---------- службові відповіді і помилки введення ----------
test("API: невідома адреса, некоректний JSON, помилки симулятора, персоналізації, погоди і станцій", async () => {
  const nf = await fetch(base + "/nope");
  assert.equal(nf.status, 404);
  assert.ok((await nf.json()).error);
  const badJson = await fetch(base + "/forecast", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
  assert.equal(badJson.status, 400);
  assert.equal((await post("/simulator/trips", {})).status, 400);
  assert.equal((await post("/simulator/trips", { vehicleId: "kia-niro-ev-64", profileId: "nope", count: 2, seed: 1 })).status, 404);
  assert.equal((await post("/personalization/replay", { vehicleId: "kia-niro-ev-64", records: "bad" })).status, 400);
  assert.equal((await post("/personalization/replay", { vehicleId: "nope", records: [] })).status, 404);
  assert.equal((await fetch(base + "/weather?lat=abc&lon=30")).status, 400);
  const st = await (await fetch(base + "/stations/nearby?lat=50.45&lon=30.52&radiusKm=30&connector=CHAdeMO&minKw=50")).json();
  assert.ok(st.stations.length > 0 && st.stations.every((s) => s.connectors.includes("CHAdeMO") && s.maxKw >= 50));
});

test("облікові записи: помилки введення, обмеження спроб входу, перевірка історії, персональні моделі", async () => {
  const a = jar();
  assert.equal((await a("POST", "/auth/login", { email: "x" })).status, 400);
  await a("POST", "/auth/register", { email: "limit@example.com", password: "12345678" });
  await a("POST", "/auth/logout");
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await a("POST", "/auth/login", { email: "limit@example.com", password: "wrong-password" })).status);
  assert.equal(codes.at(-1), 429);
  const b = jar();
  await b("POST", "/auth/register", { email: "models@example.com", password: "12345678" });
  assert.equal((await b("PUT", "/me/trips/nope", { records: [] })).status, 404);
  assert.equal((await b("PUT", "/me/trips/kia-niro-ev-64", { records: [{ id: 1 }] })).status, 400);
  const recs = await (await post("/simulator/trips", { vehicleId: "kia-niro-ev-64", profileId: "eco", count: 12, seed: 9 })).json();
  assert.equal((await b("PUT", "/me/trips/kia-niro-ev-64", { records: [...recs, recs[0]] })).status, 400);   // повтор ідентифікатора
  assert.equal((await b("PUT", "/me/trips/kia-niro-ev-64", { records: recs })).status, 200);
  const models = await (await b("GET", "/me/personal-models")).json();
  assert.equal(models.length, 1);
  assert.ok(models[0].vehicleId === "kia-niro-ev-64" && models[0].k < 1 && models[0].trips === 12);   // економний водій
});
