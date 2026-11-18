import { Router, type IRouter, type Response } from "express";
import { z } from "zod/v4";
import {
  VEHICLE_CATALOG,
  DRIVER_PROFILES,
  findVehicle,
  forecastTrip,
  generateTrips,
  replayHistory,
  validateTrip,
  withStateOfHealth,
  planRoute,
  UA_CITIES,
  DEFAULT_SAFETY,
  haversineKm,
  reliabilityScore,
  type StationRecord,
  type VehicleParams,
} from "@workspace/energy";
// Знімок відкритого набору Open Charge Map для України (research/stations/prepare_ocm.py)
import uaStations from "../data/ua_stations.json" with { type: "json" };
import { tripWeather, weatherAt } from "../lib/open-meteo.js";

export const STATIONS = uaStations as StationRecord[];
export const STATIONS_SNAPSHOT = "2026-10-10"; // дата завантаження експорту

const router: IRouter = Router();

// ---------- схеми валідації ----------
const partSchema = z.object({
  type: z.enum(["city", "suburban", "highway"]),
  km: z.number().min(0).max(2000),
  speedKmh: z.number().min(5).max(200),
  stopsPerKm: z.number().min(0).max(10),
});
const tripSchema = z.object({
  parts: z.array(partSchema).min(1).max(10),
  tempC: z.number().min(-40).max(50),
  elevGainM: z.number().min(0).max(10000),
  elevLossM: z.number().min(0).max(10000),
  headWindMs: z.number().min(-30).max(30).optional(),
});
export const vehicleRefSchema = z.object({
  vehicleId: z.string(),
  sohPct: z.number().min(40).max(100).optional(),
  usableKWh: z.number().min(5).max(200).optional(),
});
const forecastSchema = vehicleRefSchema.extend({
  trip: tripSchema,
  socStartPct: z.number().min(0).max(100),
  socArriveMinPct: z.number().min(0).max(50).optional(),
  personalFactor: z.number().min(0.5).max(2).optional(),
  historyRatios: z.array(z.number().min(0.2).max(5)).max(1000).optional(),
  lang: z.enum(["uk", "en"]).optional(),
});
export const recordSchema = z.object({
  id: z.string(),
  date: z.string(),
  trip: tripSchema,
  socStartPct: z.number().min(0).max(100),
  socEndPct: z.number().min(0).max(100),
  actualKWh: z.number().min(0),
  source: z.enum(["manual", "csv", "simulator", "dataset", "bluetooth-obd"]),
  profile: z.string().optional(),
});

function badRequest(res: Response, error: string, details?: unknown) {
  return res.status(400).json({ error, details });
}

/** Параметри автомобіля з довідника з урахуванням SoH або ручної корисної ємності */
export function resolveVehicle(ref: z.infer<typeof vehicleRefSchema>): VehicleParams | null {
  const model = findVehicle(ref.vehicleId);
  if (!model) return null;
  let p = model.params;
  if (ref.usableKWh) p = { ...p, usableKWh: ref.usableKWh };
  if (ref.sohPct) p = withStateOfHealth(p, ref.sohPct);
  return p;
}

// ---------- маршрути ----------
router.get("/vehicles/catalog", (_req, res) => {
  res.json(VEHICLE_CATALOG.map(({ params, ...v }) => ({ ...v, usableKWh: params.usableKWh, massKg: params.massKg, cd: params.cd })));
});

router.get("/simulator/profiles", (_req, res) => {
  res.json(DRIVER_PROFILES);
});

router.post("/forecast", (req, res) => {
  const parsed = forecastSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Некоректний запит прогнозу", z.flattenError(parsed.error));
  const body = parsed.data;
  const tripErrors = validateTrip(body.trip);
  if (tripErrors.length) return badRequest(res, tripErrors[0], tripErrors);
  const vehicle = resolveVehicle(body);
  if (!vehicle) return res.status(404).json({ error: "Невідома модель автомобіля" });
  return res.json(forecastTrip({ ...body, vehicle }));
});

router.post("/simulator/trips", (req, res) => {
  const parsed = vehicleRefSchema.extend({
    profileId: z.string(),
    count: z.number().int().min(1).max(200),
    seed: z.number().int().min(0).max(2 ** 31),
    startDate: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Некоректний запит до симулятора", z.flattenError(parsed.error));
  const vehicle = resolveVehicle(parsed.data);
  const profile = DRIVER_PROFILES.find((d) => d.id === parsed.data.profileId);
  if (!vehicle || !profile) return res.status(404).json({ error: "Невідома модель автомобіля або профіль водія" });
  return res.json(generateTrips(vehicle, profile, parsed.data));
});

router.post("/personalization/replay", (req, res) => {
  const parsed = vehicleRefSchema.extend({
    records: z.array(recordSchema).max(2000),
    alpha: z.number().min(0.01).max(1).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Некоректна історія поїздок", z.flattenError(parsed.error));
  const vehicle = resolveVehicle(parsed.data);
  if (!vehicle) return res.status(404).json({ error: "Невідома модель автомобіля" });
  return res.json(replayHistory(vehicle, parsed.data.records, parsed.data.alpha));
});

router.get("/route/cities", (_req, res) => {
  res.json({ cities: UA_CITIES, stations: STATIONS.length, snapshot: STATIONS_SNAPSHOT });
});

const roadFactorsSchema = z.object({ city: z.number().min(0.3).max(3), suburban: z.number().min(0.3).max(3), highway: z.number().min(0.3).max(3) });

export const routeRequestSchema = vehicleRefSchema.extend({
  fromId: z.string(),
  toId: z.string(),
  socStartPct: z.number().min(5).max(100),
  reservePct: z.number().min(0).max(30),
  tempC: z.number().min(-40).max(50).optional(),       // обов'язкова, якщо погода за прогнозом не використовується
  useWeather: z.boolean().optional(),                   // температура і вітер за прогнозом на час виїзду
  departure: z.iso.datetime({ offset: true }).optional(),
  useRelief: z.boolean().optional(),                    // висоти вузлів з цифрової моделі рельєфу (за замовчуванням так)
  personalFactor: z.number().min(0.5).max(2).optional(),
  roadFactors: roadFactorsSchema.optional(),
  safetyFactor: z.number().min(1).max(1.5).optional(),
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;

/** Перевірка запиту, погода і рельєф з Open-Meteo, побудова обох планів; повертає HTTP-статус і тіло відповіді */
export async function planRouteRequest(body: unknown): Promise<{ status: number; payload: Record<string, unknown>; request?: RouteRequest & { tempC: number } }> {
  const parsed = routeRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, payload: { error: "Некоректний запит маршруту", details: z.flattenError(parsed.error) } };
  const b = parsed.data;
  if (b.fromId === b.toId) return { status: 400, payload: { error: "Оберіть два різні міста" } };
  const from = UA_CITIES.find((c) => c.id === b.fromId), to = UA_CITIES.find((c) => c.id === b.toId);
  const model = findVehicle(b.vehicleId);
  const vehicle = resolveVehicle(b);
  if (!from || !to || !model || !vehicle) return { status: 404, payload: { error: "Невідоме місто або модель автомобіля" } };
  if (b.socStartPct <= b.reservePct) return { status: 400, payload: { error: "Заряд на старті має бути більшим за резерв" } };

  if (!b.useWeather && b.tempC === undefined) return { status: 400, payload: { error: "Вкажіть температуру повітря або увімкніть прогноз погоди" } };
  const departure = b.departure ? new Date(b.departure) : new Date();
  const weather = b.useWeather ? await tripWeather(from, to, departure) : null;
  const tempC = weather?.tempC ?? b.tempC;
  if (tempC === undefined) {
    return { status: 503, payload: { error: "Прогноз погоди зараз недоступний. Вимкніть прогноз і вкажіть температуру вручну." } };
  }
  // висоти міст і станцій – із цифрової моделі рельєфу в даних; без рельєфу всі вузли мають висоту 0
  const relief = b.useRelief !== false;
  const flat = <T extends { elevM?: number }>(p: T) => (relief ? p : { ...p, elevM: 0 });
  const result = planRoute({
    from: flat(from), to: flat(to), vehicle, ratedVehicle: model.params, connectors: model.connectors, maxDcKw: model.maxDcKw,
    socStartPct: b.socStartPct, reservePct: b.reservePct, tempC, wind: weather?.wind, personalFactor: b.personalFactor ?? 1,
    roadFactors: b.roadFactors, safetyFactor: b.safetyFactor, stations: relief ? STATIONS : STATIONS.map(flat),
  });
  const conditions = {
    tempC, headWindMs: weather?.headWindMs ?? 0, departure: departure.toISOString(),
    weather: weather ? { from: weather.from, to: weather.to, bearingDeg: weather.bearingDeg, wind: weather.wind } : null,
    weatherRequested: !!b.useWeather, weatherAvailable: !!weather,
    relief, fromElevM: relief ? from.elevM : null, toElevM: relief ? to.elevM : null,
  };
  return {
    status: 200, request: { ...b, tempC },
    payload: { from, to, dcCapable: model.maxDcKw > 0, snapshot: STATIONS_SNAPSHOT, safetyFactor: b.safetyFactor ?? DEFAULT_SAFETY, conditions, ...result },
  };
}

router.post("/route/plan", async (req, res, next) => {
  try {
    const r = await planRouteRequest(req.body);
    res.status(r.status).json(r.payload);
  } catch (e) { next(e); }
});

// ---------- погода в точці на задану годину (Open-Meteo) ----------
router.get("/weather", async (req, res, next) => {
  try {
    const parsed = z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180), time: z.iso.datetime({ offset: true }).optional() }).safeParse(req.query);
    if (!parsed.success) return badRequest(res, "Вкажіть координати і час", z.flattenError(parsed.error));
    const w = await weatherAt(parsed.data.lat, parsed.data.lon, parsed.data.time ? new Date(parsed.data.time) : new Date());
    if (!w) return res.status(503).json({ error: "Прогноз погоди для цього часу недоступний" });
    return res.json(w);
  } catch (e) { return next(e); }
});

// ---------- зарядні станції зі знімка відкритого реєстру з індексом надійності ----------
router.get("/stations/nearby", (req, res) => {
  const parsed = z.object({
    lat: z.coerce.number().min(44).max(53),
    lon: z.coerce.number().min(22).max(41),
    radiusKm: z.coerce.number().min(1).max(200).default(25),
    minKw: z.coerce.number().min(0).max(400).default(0),
    connector: z.string().max(20).optional(),
    dcOnly: z.enum(["0", "1"]).optional(),
  }).safeParse(req.query);
  if (!parsed.success) return badRequest(res, "Вкажіть координати в межах України", z.flattenError(parsed.error));
  const q = parsed.data;
  const now = new Date(STATIONS_SNAPSHOT);
  const list = STATIONS.map((s) => ({ s, km: haversineKm(q.lat, q.lon, s.lat, s.lon) }))
    .filter(({ s, km }) => km <= q.radiusKm && s.maxKw >= q.minKw && (q.dcOnly !== "1" || s.dc)
      && (!q.connector || s.connectors.some((c) => c.toLowerCase() === q.connector!.toLowerCase())))
    .sort((a, b) => a.km - b.km)
    .slice(0, 60)
    .map(({ s, km }) => {
      const r = reliabilityScore(s, now);
      return { id: s.id, title: s.title, town: s.town, lat: s.lat, lon: s.lon, maxKw: s.maxKw, dc: s.dc, connectors: s.connectors,
        points: s.points, statusTypeId: s.statusTypeId, lastVerified: s.lastVerified, checkinsOk: s.checkinsOk, checkinsFailed: s.checkinsFailed,
        distanceKm: km, reliabilityPct: r.score * 100 };
    });
  return res.json({ snapshot: STATIONS_SNAPSHOT, total: STATIONS.length, stations: list });
});

export default router;
