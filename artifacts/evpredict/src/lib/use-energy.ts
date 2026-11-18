import { useEffect, useState } from "react";
import type { ReplaySummary, TripRecord } from "@workspace/energy";
import { apiFetch } from "./api";
import type { VehicleProfile } from "./storage";

export interface CatalogEntry {
  id: string; make: string; model: string; years: string;
  connectors: string[]; maxDcKw: number; maxAcKw: number;
  usableKWh: number; massKg: number; cd: number;
}

let catalogPromise: Promise<CatalogEntry[]> | null = null;

/** Модель з довідника для обраного автомобіля */
export function useCatalogEntry(vehicleId: string | undefined) {
  const { data } = useCatalog();
  return data.find((c) => c.id === vehicleId);
}

export function useCatalog() {
  const [state, setState] = useState<{ data: CatalogEntry[]; error: string }>({ data: [], error: "" });
  useEffect(() => {
    catalogPromise ??= apiFetch<CatalogEntry[]>("/vehicles/catalog");
    catalogPromise
      .then((data) => setState({ data, error: "" }))
      .catch((e: Error) => { catalogPromise = null; setState({ data: [], error: e.message }); });
  }, []);
  return state;
}

/** Персональний коефіцієнт і точність прогнозу за історією поїздок поточного автомобіля */
export function usePersonalization(vehicle: VehicleProfile | null, trips: TripRecord[]) {
  const [summary, setSummary] = useState<ReplaySummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!vehicle || trips.length === 0) { setSummary(null); return; }
    let cancelled = false;
    apiFetch<ReplaySummary>("/personalization/replay", {
      json: { vehicleId: vehicle.vehicleId, sohPct: vehicle.sohPct, records: trips },
    })
      .then((s) => { if (!cancelled) { setSummary(s); setError(""); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [vehicle, trips]);
  return { summary, error };
}
