// Облікові записи і дані користувача в базі: вхід і реєстрація, автомобіль, історія поїздок,
// персональна модель (перераховується після кожного збереження історії), збережені плани маршрутів.
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, desc, eq, inArray } from "drizzle-orm";
import { findVehicle, replayHistory, safetyFromHistory, MIN_SOC_DROP_FOR_LEARNING, type TripRecord, type RouteOption } from "@workspace/energy";
import { personalModels, routePlans, routeStops, trips, users, vehicles, type Db } from "@workspace/db";
import { withDb } from "../lib/db.js";
import { currentUser, endSession, hashPassword, requireUser, resetAttempts, startSession, tooManyAttempts, verifyPassword } from "../lib/auth.js";
import { planRouteRequest, recordSchema, resolveVehicle } from "./energy.js";

const router: IRouter = Router();
router.use(["/auth", "/me"], withDb);

// ---------- вхід і реєстрація ----------
const credentials = z.object({
  email: z.email().max(200).transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8).max(200),
});

router.post("/auth/register", async (req, res, next) => {
  try {
    const parsed = credentials.extend({ name: z.string().trim().max(100).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Вкажіть коректну електронну адресу і пароль щонайменше з 8 символів" });
    const { email, password, name } = parsed.data;
    const exists = await req.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (exists.length) return res.status(409).json({ error: "Обліковий запис з такою адресою вже існує" });
    const [u] = await req.db.insert(users).values({ email, passwordHash: await hashPassword(password), name: name || null })
      .returning({ id: users.id, email: users.email, name: users.name });
    await startSession(req.db, res, u.id);
    return res.status(201).json({ user: u });
  } catch (e) { return next(e); }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Вкажіть електронну адресу і пароль" });
    const { email, password } = parsed.data;
    const key = `${req.ip}|${email}`;
    if (tooManyAttempts(key)) return res.status(429).json({ error: "Забагато спроб входу. Спробуйте через 10 хвилин" });
    const [u] = await req.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!u || !(await verifyPassword(password, u.passwordHash))) return res.status(401).json({ error: "Неправильна адреса або пароль" });
    resetAttempts(key);
    await startSession(req.db, res, u.id);
    return res.json({ user: { id: u.id, email: u.email, name: u.name } });
  } catch (e) { return next(e); }
});

router.post("/auth/logout", async (req, res, next) => {
  try { await endSession(req.db, req, res); res.json({ ok: true }); } catch (e) { next(e); }
});

router.get("/auth/me", async (req, res, next) => {
  try {
    const u = await currentUser(req.db, req);
    if (!u) return res.status(401).json({ error: "Потрібно увійти в обліковий запис" });
    return res.json({ user: u });
  } catch (e) { return next(e); }
});

// ---------- дані користувача ----------
router.use("/me", requireUser);

interface VehicleProfile { vehicleId: string; label: string; sohPct: number; usableKWh: number }
const profileOf = (v: { modelId: string; label: string; sohPct: number }): VehicleProfile => ({
  vehicleId: v.modelId, label: v.label, sohPct: v.sohPct, usableKWh: findVehicle(v.modelId)?.params.usableKWh ?? 0,
});

type TripRow = typeof trips.$inferSelect;
const toRecord = (t: TripRow): TripRecord => ({
  id: t.clientId, date: t.startedAt.toISOString(), source: t.source, socStartPct: t.socStartPct, socEndPct: t.socEndPct, actualKWh: t.actualKWh,
  trip: { parts: t.parts as TripRecord["trip"]["parts"], tempC: t.tempC, elevGainM: t.elevGainM, elevLossM: t.elevLossM },
  ...(t.simulatedProfile ? { profile: t.simulatedProfile } : {}),
});

router.get("/me/state", async (req, res, next) => {
  try {
    const vs = await req.db.select().from(vehicles).where(eq(vehicles.userId, req.user.id));
    const ts = vs.length ? await req.db.select().from(trips).where(inArray(trips.vehicleId, vs.map((v) => v.id))).orderBy(trips.startedAt) : [];
    const byVehicle: Record<string, TripRecord[]> = {};
    for (const v of vs) byVehicle[v.modelId] = ts.filter((t) => t.vehicleId === v.id).map(toRecord);
    const current = vs.find((v) => v.isCurrent);
    res.json({ user: req.user, vehicle: current ? profileOf(current) : null, trips: byVehicle });
  } catch (e) { next(e); }
});

const vehicleBody = z.object({ vehicleId: z.string(), sohPct: z.number().min(40).max(100) });

async function upsertVehicle(db: Db, userId: number, modelId: string, sohPct?: number) {
  const model = findVehicle(modelId)!;
  const label = `${model.make} ${model.model}`;
  const [row] = await db.insert(vehicles).values({ userId, modelId, sohPct: sohPct ?? 100, label })
    .onConflictDoUpdate({ target: [vehicles.userId, vehicles.modelId], set: sohPct !== undefined ? { sohPct, label } : { label } })
    .returning();
  return row;
}

router.put("/me/vehicle", async (req, res, next) => {
  try {
    const parsed = vehicleBody.safeParse(req.body);
    if (!parsed.success || !findVehicle(parsed.data.vehicleId)) return res.status(400).json({ error: "Оберіть модель із довідника і стан батареї від 40 до 100 %" });
    const { vehicleId, sohPct } = parsed.data;
    const row = await req.db.transaction(async (tx) => {
      await tx.update(vehicles).set({ isCurrent: false }).where(eq(vehicles.userId, req.user.id));
      const r = await upsertVehicle(tx as unknown as Db, req.user.id, vehicleId, sohPct);
      await tx.update(vehicles).set({ isCurrent: true }).where(eq(vehicles.id, r.id));
      return r;
    });
    // зміна SoH змінює прогнози, тому персональна модель перераховується
    await refreshPersonalModel(req.db, row.id, vehicleId, sohPct);
    return res.json({ vehicle: profileOf({ ...row, sohPct }) });
  } catch (e) { return next(e); }
});

/** Перерахунок персональної моделі (k, k_t, σ, похибки) за всією історією автомобіля */
async function refreshPersonalModel(db: Db, vehicleRowId: number, modelId: string, sohPct: number) {
  const rows = await db.select().from(trips).where(eq(trips.vehicleId, vehicleRowId));
  if (!rows.length) { await db.delete(personalModels).where(eq(personalModels.vehicleId, vehicleRowId)); return null; }
  const p = resolveVehicle({ vehicleId: modelId, sohPct })!;
  const s = replayHistory(p, rows.map(toRecord));
  const values = {
    k: s.personalFactor, kCity: s.roadFactors.city, kSuburban: s.roadFactors.suburban, kHighway: s.roadFactors.highway,
    sigma: safetyFromHistory(s.personalFactor, s.ratios), trips: s.trips, reliableTrips: s.reliableTrips,
    mapeModelPct: s.mapeModelPct, mapePersonalPct: s.mapePersonalPct, updatedAt: new Date(),
  };
  await db.insert(personalModels).values({ vehicleId: vehicleRowId, ...values })
    .onConflictDoUpdate({ target: personalModels.vehicleId, set: values });
  return values;
}

const tripsBody = z.object({ records: z.array(recordSchema).max(2000) });

router.put("/me/trips/:vehicleId", async (req, res, next) => {
  try {
    const modelId = String(req.params.vehicleId);
    if (!findVehicle(modelId)) return res.status(404).json({ error: "Невідома модель автомобіля" });
    const parsed = tripsBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Некоректна історія поїздок", details: z.flattenError(parsed.error) });
    const records = parsed.data.records;
    const ids = new Set(records.map((r) => r.id));
    if (ids.size !== records.length) return res.status(400).json({ error: "Ідентифікатори поїздок повторюються" });
    const v = await upsertVehicle(req.db, req.user.id, modelId);
    // історія замінюється цілком в одній транзакції: стан у базі завжди відповідає стану в застосунку
    await req.db.transaction(async (tx) => {
      await tx.delete(trips).where(eq(trips.vehicleId, v.id));
      for (let i = 0; i < records.length; i += 500) {
        await tx.insert(trips).values(records.slice(i, i + 500).map((r) => ({
          vehicleId: v.id, clientId: r.id, startedAt: new Date(r.date), parts: r.trip.parts, tempC: r.trip.tempC,
          elevGainM: r.trip.elevGainM, elevLossM: r.trip.elevLossM, socStartPct: r.socStartPct, socEndPct: r.socEndPct,
          actualKWh: r.actualKWh, source: r.source, simulatedProfile: r.source === "simulator" ? r.profile ?? null : null,
          usedForLearning: r.socStartPct - r.socEndPct >= MIN_SOC_DROP_FOR_LEARNING,
        })));
      }
    });
    const model = await refreshPersonalModel(req.db, v.id, modelId, v.sohPct);
    return res.json({ saved: records.length, personalModel: model });
  } catch (e) { return next(e); }
});

router.get("/me/personal-models", async (req, res, next) => {
  try {
    const rows = await req.db.select({ vehicleId: vehicles.modelId, label: vehicles.label, m: personalModels })
      .from(personalModels).innerJoin(vehicles, eq(vehicles.id, personalModels.vehicleId))
      .where(eq(vehicles.userId, req.user.id));
    res.json(rows.map((r) => ({ ...r.m, vehicleId: r.vehicleId, label: r.label })));
  } catch (e) { next(e); }
});

/** Усі дані користувача одним файлом JSON */
router.get("/me/export", async (req, res, next) => {
  try {
    const vs = await req.db.select().from(vehicles).where(eq(vehicles.userId, req.user.id));
    const ids = vs.map((v) => v.id);
    const ts = ids.length ? await req.db.select().from(trips).where(inArray(trips.vehicleId, ids)) : [];
    const pm = ids.length ? await req.db.select().from(personalModels).where(inArray(personalModels.vehicleId, ids)) : [];
    const rp = ids.length ? await req.db.select().from(routePlans).where(inArray(routePlans.vehicleId, ids)) : [];
    res.setHeader("Content-Disposition", `attachment; filename="evpredict-export.json"`);
    res.json({
      exportedAt: new Date().toISOString(), user: req.user,
      vehicles: vs.map((v) => ({ ...profileOf(v), isCurrent: v.isCurrent, createdAt: v.createdAt,
        trips: ts.filter((t) => t.vehicleId === v.id).map(toRecord),
        personalModel: pm.find((m) => m.vehicleId === v.id) ?? null,
        routePlans: rp.filter((r) => r.vehicleId === v.id) })),
    });
  } catch (e) { next(e); }
});

router.delete("/me", async (req, res, next) => {
  try {
    await req.db.delete(users).where(eq(users.id, req.user.id));   // решта даних видаляється каскадно
    await endSession(req.db, req, res);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- збережені плани маршрутів ----------
router.post("/me/routes", async (req, res, next) => {
  try {
    const r = await planRouteRequest(req.body);
    if (r.status !== 200 || !r.request) return res.status(r.status).json(r.payload);
    const body = r.request;
    const v = await upsertVehicle(req.db, req.user.id, body.vehicleId);
    const sigma = r.payload.safetyFactor as number;
    const corridorKm = r.payload.corridorKm as number;
    const ids: number[] = [];
    await req.db.transaction(async (tx) => {
      for (const planner of ["evpredict", "baseline"] as const) {
        const o = r.payload[planner] as RouteOption;
        if (!o.found) continue;
        const [plan] = await tx.insert(routePlans).values({
          vehicleId: v.id, planner, fromCity: body.fromId, toCity: body.toId, socStartPct: body.socStartPct, reservePct: body.reservePct,
          tempC: body.tempC, sigma: planner === "evpredict" ? sigma : 1, corridorKm, km: o.km, totalMinutes: o.totalMinutes,
          chargeMinutes: o.chargeMinutes, minSocPct: o.minSocPct, arriveSocPct: o.arriveSocPct, risky: o.risky,
        }).returning({ id: routePlans.id });
        ids.push(plan.id);
        await tx.insert(routeStops).values(o.stops.map((s, seq) => ({
          planId: plan.id, seq, title: s.kind === "station" ? s.title : s.kind === "origin" ? body.fromId : body.toId, town: s.town || null,
          kmFromStart: s.kmFromStart, socArrivePct: s.socArrivePct, chargeToPct: s.chargeToPct ?? null, chargeMinutes: s.chargeMinutes ?? null,
        })));
      }
    });
    return res.status(201).json({ ids });
  } catch (e) { return next(e); }
});

router.get("/me/routes", async (req, res, next) => {
  try {
    const rows = await req.db.select({ p: routePlans, modelId: vehicles.modelId }).from(routePlans)
      .innerJoin(vehicles, eq(vehicles.id, routePlans.vehicleId))
      .where(and(eq(vehicles.userId, req.user.id), eq(routePlans.planner, "evpredict")))
      .orderBy(desc(routePlans.createdAt)).limit(20);
    res.json(rows.map((r) => ({ ...r.p, vehicleId: r.modelId })));
  } catch (e) { next(e); }
});

export default router;
