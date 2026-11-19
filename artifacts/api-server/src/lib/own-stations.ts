// Власні точки заряду користувача (дім, знайома розетка): зберігаються в базі й додаються до станцій реєстру під час планування.
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { haversineKm, type StationRecord } from "@workspace/energy";
import { ownStations, type Db } from "@workspace/db";
import { SESSION_COOKIE, currentUser } from "./auth.js";
import { database } from "./db.js";

type OwnRow = typeof ownStations.$inferSelect;

/** Висота власної точки – як у найближчої станції реєстру (висоти станцій узято з цифрової моделі рельєфу) */
function nearestElev(lat: number, lon: number, registry: StationRecord[]): number | undefined {
  let best: StationRecord | undefined, bestKm = Infinity;
  for (const s of registry) {
    if (s.elevM === undefined) continue;
    const km = haversineKm(lat, lon, s.lat, s.lon);
    if (km < bestKm) { bestKm = km; best = s; }
  }
  return best?.elevM;
}

export function toStationRecord(r: OwnRow, registry: StationRecord[]): StationRecord {
  return { id: r.id, title: r.title, town: "", lat: r.lat, lon: r.lon, maxKw: r.maxKw, dc: r.dc, connectors: [], points: 1,
    statusTypeId: null, lastVerified: null, checkinsOk: 0, checkinsFailed: 0, own: true, elevM: nearestElev(r.lat, r.lon, registry) };
}

export async function ownStationRecords(db: Db, userId: number, registry: StationRecord[]): Promise<StationRecord[]> {
  const rows = await db.select().from(ownStations).where(eq(ownStations.userId, userId));
  return rows.map((r) => toStationRecord(r, registry));
}

/** Для публічного запиту плану: власні точки додаються, лише якщо є чинний сеанс */
export async function ownStationsForRequest(req: Request, registry: StationRecord[]): Promise<StationRecord[]> {
  if (typeof req.cookies?.[SESSION_COOKIE] !== "string") return [];
  const { db } = await database();
  const user = await currentUser(db, req);
  return user ? ownStationRecords(db, user.id, registry) : [];
}
