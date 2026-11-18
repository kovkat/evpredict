// Стан застосунку: сеанс користувача, обраний автомобіль та історія поїздок.
// Джерело даних – база на сервері (/api/me/...). Зміни показуються одразу, а запис на сервер іде у фоні;
// якщо запис не вдався, користувач бачить повідомлення. Історія, яку раніше зберігав браузер (до появи облікових
// записів), переноситься в базу під час першого входу.
import { useSyncExternalStore } from "react";
import type { TripRecord } from "@workspace/energy";
import { apiFetch, ApiError } from "./api";

export interface VehicleProfile {
  vehicleId: string;
  label: string;
  sohPct: number;
  usableKWh: number;       // корисна ємність з довідника (до врахування SoH)
}

export interface User { id: number; email: string; name: string | null }

interface State {
  status: "loading" | "anon" | "ready" | "offline";
  user: User | null;
  vehicle: VehicleProfile | null;
  trips: Record<string, TripRecord[]>;
  syncError: string;
  bootError: string;
}

let state: State = { status: "loading", user: null, vehicle: null, trips: {}, syncError: "", bootError: "" };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const EMPTY: TripRecord[] = [];

export const useAppState = <T>(select: (s: State) => T) => useSyncExternalStore(subscribe, () => select(state));
export const useSession = () => useAppState((s) => s.user);
export const useVehicle = () => useAppState((s) => s.vehicle);
export const useTrips = (vehicleId: string | undefined) => useAppState((s) => (vehicleId ? s.trips[vehicleId] ?? EMPTY : EMPTY));
export const useSyncError = () => useAppState((s) => s.syncError);

interface StateResponse { user: User; vehicle: VehicleProfile | null; trips: Record<string, TripRecord[]> }

// ---------- сеанс ----------
export async function boot() {
  set({ status: "loading", bootError: "" });
  try {
    await apiFetch<{ user: User }>("/auth/me");
    await loadState();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) set({ status: "anon", user: null, vehicle: null, trips: {} });
    else set({ status: "offline", bootError: (e as Error).message });
  }
}

async function loadState() {
  let s = await apiFetch<StateResponse>("/me/state");
  if (await migrateBrowserHistory(s)) s = await apiFetch<StateResponse>("/me/state");
  set({ status: "ready", user: s.user, vehicle: s.vehicle, trips: s.trips, syncError: "" });
}

export async function login(email: string, password: string) {
  await apiFetch("/auth/login", { json: { email, password } });
  await loadState();
}

export async function register(email: string, password: string, name: string) {
  await apiFetch("/auth/register", { json: { email, password, name: name || undefined } });
  await loadState();
}

export async function logout() {
  try { await apiFetch("/auth/logout", { json: {} }); } finally { set({ status: "anon", user: null, vehicle: null, trips: {} }); }
}

export async function deleteAccount() {
  await apiFetch("/me", { method: "DELETE" });
  set({ status: "anon", user: null, vehicle: null, trips: {} });
}

// ---------- автомобіль і поїздки ----------
export async function saveVehicle(v: VehicleProfile) {
  const previous = state.vehicle;
  set({ vehicle: v });
  try {
    const r = await apiFetch<{ vehicle: VehicleProfile }>("/me/vehicle", { method: "PUT", json: { vehicleId: v.vehicleId, sohPct: v.sohPct } });
    set({ vehicle: r.vehicle, syncError: "" });
  } catch (e) {
    set({ vehicle: previous, syncError: `Автомобіль не збережено: ${(e as Error).message}` });
    throw e;
  }
}

// записи історії для одного автомобіля виконуються послідовно; якщо поки йшов запис історія знову змінилася,
// на сервер відправляється лише найновіший стан
const queued = new Map<string, TripRecord[]>();
const running = new Set<string>();

export function saveTrips(vehicleId: string, trips: TripRecord[]) {
  set({ trips: { ...state.trips, [vehicleId]: trips } });
  queued.set(vehicleId, trips);
  if (!running.has(vehicleId)) void flush(vehicleId);
}

async function flush(vehicleId: string) {
  running.add(vehicleId);
  try {
    while (queued.has(vehicleId)) {
      const records = queued.get(vehicleId)!;
      queued.delete(vehicleId);
      try {
        await apiFetch(`/me/trips/${encodeURIComponent(vehicleId)}`, { method: "PUT", json: { records } });
        set({ syncError: "" });
      } catch (e) {
        set({ syncError: `Історію поїздок не збережено на сервері: ${(e as Error).message}` });
      }
    }
  } finally { running.delete(vehicleId); }
}

// ---------- перенесення історії з браузера ----------
const LEGACY = { vehicle: "evpredict.vehicle", trips: "evpredict.trips." } as const;

function readLegacy(): { vehicle: VehicleProfile | null; trips: Record<string, TripRecord[]> } | null {
  try {
    const ls = window.localStorage;
    const vehicleRaw = ls.getItem(LEGACY.vehicle);
    const trips: Record<string, TripRecord[]> = {};
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key?.startsWith(LEGACY.trips)) {
        const list = JSON.parse(ls.getItem(key) ?? "[]") as TripRecord[];
        if (Array.isArray(list) && list.length) trips[key.slice(LEGACY.trips.length)] = list;
      }
    }
    if (!vehicleRaw && !Object.keys(trips).length) return null;
    return { vehicle: vehicleRaw ? (JSON.parse(vehicleRaw) as VehicleProfile) : null, trips };
  } catch { return null; }
}

function clearLegacy() {
  try {
    const ls = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && (k === LEGACY.vehicle || k.startsWith(LEGACY.trips))) keys.push(k); }
    keys.forEach((k) => ls.removeItem(k));
  } catch { /* сховище недоступне */ }
}

/** Переносить у базу лише те, чого в обліковому записі ще немає; повертає true, якщо щось перенесено */
async function migrateBrowserHistory(s: StateResponse): Promise<boolean> {
  const legacy = readLegacy();
  if (!legacy) return false;
  let moved = false;
  try {
    for (const [vehicleId, records] of Object.entries(legacy.trips)) {
      if (vehicleId === "none" || s.trips[vehicleId]?.length) continue;
      await apiFetch(`/me/trips/${encodeURIComponent(vehicleId)}`, { method: "PUT", json: { records } });
      moved = true;
    }
    if (legacy.vehicle && !s.vehicle) {
      await apiFetch("/me/vehicle", { method: "PUT", json: { vehicleId: legacy.vehicle.vehicleId, sohPct: legacy.vehicle.sohPct } });
      moved = true;
    }
    clearLegacy();
  } catch { /* дані лишаються в браузері, спроба повториться під час наступного входу */ }
  return moved;
}
