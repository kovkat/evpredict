// Зарядні станції поблизу: знімок відкритого реєстру Open Charge Map для України з індексом надійності кожної станції
import { Activity, ExternalLink, MapPinned, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { num, type City } from "@workspace/energy";
import { EmptyState, Notice, PageHeader, SelectField, StatusPill, Surface } from "@/components/kit";
import { apiFetch } from "@/lib/api";
import { useVehicle } from "@/lib/storage";
import { useCatalogEntry } from "@/lib/use-energy";
import { day, fmt, plural } from "@/lib/format";

interface NearbyStation {
  id: number; title: string; town: string; lat: number; lon: number; maxKw: number; dc: boolean; connectors: string[];
  points: number; statusTypeId: number | null; lastVerified: string | null; checkinsOk: number; checkinsFailed: number;
  distanceKm: number; reliabilityPct: number;
}
interface NearbyResponse { snapshot: string; total: number; stations: NearbyStation[] }

// коди статусів Open Charge Map
const STATUS: Record<number, string> = { 10: "працює", 20: "працює", 50: "працює", 75: "працює частково", 30: "тимчасово недоступна", 100: "не працює", 150: "запланована", 200: "виведена з експлуатації", 210: "виведена з експлуатації" };
const statusLabel = (id: number | null) => (id === null || id === 0 ? "статус невідомий" : STATUS[id] ?? (id >= 150 ? "не введена в експлуатацію" : "статус невідомий"));

export function ChargingPage() {
  const vehicle = useVehicle();
  const model = useCatalogEntry(vehicle?.vehicleId);
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState("kyiv");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [radius, setRadius] = useState("15");
  const [minKw, setMinKw] = useState("0");
  const [connector, setConnector] = useState("");
  const [dcOnly, setDcOnly] = useState(false);
  const [data, setData] = useState<NearbyResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiFetch<{ cities: City[] }>("/route/cities").then((r) => setCities(r.cities)).catch((e: Error) => setError(e.message)); }, []);
  // для обраного автомобіля за замовчуванням показуються лише сумісні роз'єми
  useEffect(() => { if (model && !connector) setConnector(model.connectors.includes("CCS") ? "CCS" : model.connectors[0] ?? ""); }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = coords ?? cities.find((c) => c.id === cityId) ?? null;

  useEffect(() => {
    if (!point) return;
    const q = new URLSearchParams({ lat: String(point.lat), lon: String(point.lon), radiusKm: radius || "15", minKw: minKw || "0", ...(connector ? { connector } : {}), ...(dcOnly ? { dcOnly: "1" } : {}) });
    setLoading(true);
    const t = setTimeout(() => {
      apiFetch<NearbyResponse>(`/stations/nearby?${q}`).then((r) => { setData(r); setError(""); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [point?.lat, point?.lon, radius, minKw, connector, dcOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const useMyLocation = () => {
    setError("");
    if (!navigator.geolocation) return setError("Браузер не підтримує визначення місцезнаходження.");
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setError("Доступ до місцезнаходження не надано. Оберіть місто зі списку."),
    );
  };

  const rhoMin = num("minReliability") * 100;
  const stations = data?.stations ?? [];

  return (
    <div className="animate-enter">
      <PageHeader title="Зарядні станції" description="Станції поблизу з відкритого реєстру Open Charge Map з оцінкою надійності, яку використовує планувальник маршрутів."
        action={<StatusPill muted>{data ? `Знімок ${day(data.snapshot)} · ${data.total} станцій` : "Open Charge Map"}</StatusPill>} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[.7fr_1.3fr]">
        <Surface className="h-fit p-5 md:p-6">
          <div className="mb-5 flex items-center gap-3"><PlugZap size={17} className="text-[hsl(var(--primary))]" /><h2 className="text-[15px] font-bold">Пошук</h2></div>
          <div className="grid gap-4">
            <SelectField label="Місто" id="charging-city" value={coords ? "" : cityId} onChange={(v) => { setCoords(null); setCityId(v); }}>
              {coords && <option value="">Моє місцезнаходження</option>}
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Радіус" id="charging-radius" value={radius} onChange={setRadius}>
                {["5", "10", "15", "25", "50"].map((r) => <option key={r} value={r}>{r} км</option>)}
              </SelectField>
              <SelectField label="Потужність від" id="charging-min-kw" value={minKw} onChange={setMinKw}>
                {["0", "22", "50", "100", "150"].map((r) => <option key={r} value={r}>{r === "0" ? "будь-яка" : `${r} кВт`}</option>)}
              </SelectField>
            </div>
            <SelectField label="Роз'єм" id="charging-connector" value={connector} onChange={setConnector}>
              <option value="">Будь-який</option>
              {["CCS", "CHAdeMO", "Type 2", "NACS", "GB/T"].map((c) => <option key={c} value={c}>{c}{model?.connectors.includes(c as never) ? " · ваш автомобіль" : ""}</option>)}
            </SelectField>
            <label className="flex cursor-pointer items-center gap-3 text-[12px]">
              <input type="checkbox" checked={dcOnly} onChange={(e) => setDcOnly(e.target.checked)} data-testid="checkbox-dc-only" className="accent-[hsl(var(--primary))]" />
              Лише швидкі станції постійного струму
            </label>
          </div>
          <button type="button" className="action-secondary mt-5" data-testid="button-use-location" onClick={useMyLocation}><MapPinned size={14} />Моє місцезнаходження</button>
          {error && <div className="mt-4"><Notice tone="error" testId="text-charging-error">{error}</Notice></div>}
          <div className="mt-5">
            <Notice>
              Індекс надійності – апріорна оцінка ймовірності, що станція працює: статус у реєстрі, давність перевірки, кількість точок заряджання і відгуки користувачів. Станції з індексом нижче {fmt(rhoMin, 0)} % планувальник маршрутів не використовує.
            </Notice>
          </div>
        </Surface>

        <Surface className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
            <h2 className="text-[15px] font-bold">Станції поблизу</h2>
            <span className="font-mono text-[10px] text-dim" data-testid="text-stations-count">{loading ? "пошук…" : `${stations.length} ${plural(stations.length, ["станція", "станції", "станцій"])}`}</span>
          </div>
          {!loading && !stations.length && (
            <div className="grid-signal min-h-[360px]"><EmptyState icon={loading ? Activity : PlugZap} title="Станцій не знайдено" detail="Збільште радіус або послабте фільтри." /></div>
          )}
          {stations.length > 0 && (
            <div className="max-h-[680px] divide-y divide-[hsl(var(--border))] overflow-y-auto" data-testid="list-stations">
              {stations.map((s) => (
                <div key={s.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold">{s.title || "Зарядна станція"}</div>
                      <div className="mt-1 text-[10px] leading-5 text-dim">{s.town} · {statusLabel(s.statusTypeId)}{s.lastVerified ? ` · перевірено ${day(s.lastVerified)}` : " · дата перевірки невідома"}</div>
                    </div>
                    <a href={`https://openchargemap.org/site/poi/details/${s.id}`} target="_blank" rel="noreferrer" className="shrink-0 text-dim hover:text-[hsl(var(--primary))]" aria-label="Відкрити в Open Charge Map"><ExternalLink size={14} /></a>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-4">
                    {[
                      ["Відстань", `${fmt(s.distanceKm, 1)} км`],
                      ["Потужність", s.maxKw > 0 ? `${fmt(s.maxKw, 0)} кВт ${s.dc ? "DC" : "AC"}` : "—"],
                      ["Роз'єми", s.connectors.length ? s.connectors.join(", ") : "—"],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-md border border-[hsl(var(--border))] p-3"><div className="eyebrow mb-1">{k}</div><div className="truncate font-mono text-[11px]">{v}</div></div>
                    ))}
                    <div className={`rounded-md border p-3 ${s.reliabilityPct < rhoMin ? "border-[hsl(var(--destructive)/.4)]" : "border-[hsl(var(--border))]"}`}>
                      <div className="eyebrow mb-1">Надійність</div>
                      <div className={`font-mono text-[11px] ${s.reliabilityPct < rhoMin ? "text-[hsl(var(--destructive))]" : ""}`}>{fmt(s.reliabilityPct, 0)} %</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
