// Схема бази даних EVPredict (PostgreSQL). Довідник моделей автомобілів зберігається в коді (lib/energy/src/vehicles.ts),
// тут – облікові записи і сеанси, автомобілі користувачів, історія поїздок, персональні моделі, знімок станцій і збережені плани маршрутів.
import { pgTable, serial, integer, text, real, boolean, timestamp, jsonb, index, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";

export const tripSource = pgEnum("trip_source", ["manual", "csv", "simulator", "dataset", "bluetooth-obd"]);
export const plannerKind = pgEnum("planner_kind", ["evpredict", "baseline"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),                      // зберігається в нижньому регістрі
  passwordHash: text("password_hash").notNull(),       // scrypt із випадковою сіллю
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

// Сеанс входу: у cookie лежить випадковий токен, у базі – лише його хеш SHA-256
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),                 // ідентифікатор моделі з довідника, напр. "nissan-leaf-40"
  sohPct: real("soh_pct").notNull(),                   // стан батареї, 40–100 %
  label: text("label").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("vehicles_user_model_uq").on(t.userId, t.modelId)]);

// Поїздка: опис частинами «місто / приміська / траса» і показ SoC на початку та в кінці
export const trips = pgTable("trips", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),               // ідентифікатор запису, створений у застосунку
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  parts: jsonb("parts").notNull(),                     // [{ type, km, speedKmh, stopsPerKm }]
  tempC: real("temp_c").notNull(),
  elevGainM: real("elev_gain_m").notNull().default(0),
  elevLossM: real("elev_loss_m").notNull().default(0),
  socStartPct: real("soc_start_pct").notNull(),
  socEndPct: real("soc_end_pct").notNull(),
  actualKWh: real("actual_kwh").notNull(),
  source: tripSource("source").notNull(),
  simulatedProfile: text("simulated_profile"),         // лише для source = simulator
  usedForLearning: boolean("used_for_learning").notNull(),
}, (t) => [index("trips_vehicle_time_idx").on(t.vehicleId, t.startedAt), uniqueIndex("trips_vehicle_client_uq").on(t.vehicleId, t.clientId)]);

// Персональна модель автомобіля і водія – результат «програвання» історії поїздок
export const personalModels = pgTable("personal_models", {
  vehicleId: integer("vehicle_id").primaryKey().references(() => vehicles.id, { onDelete: "cascade" }),
  k: real("k").notNull(),
  kCity: real("k_city").notNull(),
  kSuburban: real("k_suburban").notNull(),
  kHighway: real("k_highway").notNull(),
  sigma: real("sigma").notNull(),
  trips: integer("trips").notNull(),
  reliableTrips: integer("reliable_trips").notNull(),
  mapeModelPct: real("mape_model_pct"),
  mapePersonalPct: real("mape_personal_pct"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Знімок відкритого реєстру станцій і обчислений індекс надійності
export const stations = pgTable("stations", {
  id: serial("id").primaryKey(),
  ocmId: integer("ocm_id").notNull(),
  title: text("title").notNull(),
  town: text("town"),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  maxKw: real("max_kw").notNull(),
  dc: boolean("dc").notNull(),
  connectors: text("connectors").array().notNull(),
  points: integer("points").notNull(),
  statusTypeId: integer("status_type_id"),
  lastVerified: timestamp("last_verified", { withTimezone: true }),
  checkinsOk: integer("checkins_ok").notNull().default(0),
  checkinsFailed: integer("checkins_failed").notNull().default(0),
  reliabilityIndex: real("reliability_index").notNull(),
  snapshotDate: timestamp("snapshot_date", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("stations_ocm_uq").on(t.ocmId, t.snapshotDate), index("stations_geo_idx").on(t.lat, t.lon)]);

// Збережений план поїздки між містами (запропонований або базовий)
export const routePlans = pgTable("route_plans", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  planner: plannerKind("planner").notNull(),
  fromCity: text("from_city").notNull(),
  toCity: text("to_city").notNull(),
  socStartPct: real("soc_start_pct").notNull(),
  reservePct: real("reserve_pct").notNull(),
  tempC: real("temp_c").notNull(),
  sigma: real("sigma").notNull(),
  corridorKm: integer("corridor_km").notNull(),
  km: real("km").notNull(),
  totalMinutes: real("total_minutes").notNull(),
  chargeMinutes: real("charge_minutes").notNull(),
  minSocPct: real("min_soc_pct").notNull(),
  arriveSocPct: real("arrive_soc_pct").notNull(),
  risky: boolean("risky").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("route_plans_vehicle_idx").on(t.vehicleId)]);

export const routeStops = pgTable("route_stops", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => routePlans.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  stationId: integer("station_id").references(() => stations.id),   // null для пунктів A і B
  title: text("title").notNull(),
  town: text("town"),
  kmFromStart: real("km_from_start").notNull(),
  socArrivePct: real("soc_arrive_pct").notNull(),
  chargeToPct: real("charge_to_pct"),
  chargeMinutes: real("charge_minutes"),
}, (t) => [uniqueIndex("route_stops_plan_seq_uq").on(t.planId, t.seq)]);
