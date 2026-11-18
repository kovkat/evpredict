import { AlertTriangle, BrainCircuit, CarFront, CheckCircle2, Clock, Gauge, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { DEFAULT_PARTS, REFERENCE, num, type City, type Forecast, type RoadType, type TripInput } from "@workspace/energy";
import { EmptyState, NumberInput, PageHeader, SelectField, StatusPill, Surface } from "@/components/kit";
import { apiFetch } from "@/lib/api";
import { useTrips, useVehicle } from "@/lib/storage";
import { usePersonalization } from "@/lib/use-energy";
import { ROADS, ROAD_LABEL } from "@/lib/model";
import { dayTime, fmt, hm, nextHourLocal, plural, signed, windFrom } from "@/lib/format";

interface WeatherPoint { time: string; tempC: number; windMs: number; windFromDeg: number; source: "forecast" | "archive" }

/** Підстановка температури з прогнозу погоди для міста і часу виїзду */
function WeatherHelper({ onTemp }: { onTemp: (t: number) => void }) {
  const [open, setOpen] = useState(false);
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState("kyiv");
  const [when, setWhen] = useState(nextHourLocal);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && !cities.length) apiFetch<{ cities: City[] }>("/route/cities").then((r) => setCities(r.cities)).catch(() => undefined); }, [open, cities.length]);
  if (!open) return <button type="button" className="text-[11px] font-bold text-[hsl(var(--primary))]" data-testid="button-weather-open" onClick={() => setOpen(true)}>Підставити температуру з прогнозу погоди</button>;
  const city = cities.find((c) => c.id === cityId);
  const load = async () => {
    if (!city) return;
    setBusy(true); setNote("");
    try {
      const w = await apiFetch<WeatherPoint>(`/weather?lat=${city.lat}&lon=${city.lon}&time=${encodeURIComponent(new Date(when).toISOString())}`);
      onTemp(Math.round(w.tempC));
      setNote(`${city.name}, ${dayTime(w.time)}: ${signed(w.tempC, 1)} °C, вітер ${fmt(w.windMs, 0)} м/с ${windFrom(w.windFromDeg)}${w.source === "archive" ? " (архів погоди)" : ""}.`);
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
        <SelectField label="Місто" id="weather-city" value={cityId} onChange={setCityId}>{cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
        <label className="block"><span className="label">Час виїзду</span><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="field" data-testid="input-weather-time" /></label>
        <button type="button" className="action-secondary" data-testid="button-weather-load" disabled={busy || !city} onClick={() => void load()}>{busy ? "…" : "Підставити"}</button>
      </div>
      {note && <div className="mt-2 text-[10px] leading-4 text-dim" data-testid="text-weather-note">{note}</div>}
    </div>
  );
}

/** Мінімальний заряд на старті, щоб прибути із запасом навіть за песимістичної оцінки */
const neededPct = (f: Forecast) => Math.ceil((f.energyHighKWh / f.energyKWh) * f.socUsedPct + f.socArriveMinPct);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function PredictionPage() {
  const vehicle = useVehicle();
  const trips = useTrips(vehicle?.vehicleId);
  const { summary } = usePersonalization(vehicle, trips);

  const [km, setKm] = useState<Record<RoadType, string>>({ city: "8", suburban: "0", highway: "70" });
  const [speed, setSpeed] = useState<Record<RoadType, string>>({
    city: String(DEFAULT_PARTS.city.speedKmh), suburban: String(DEFAULT_PARTS.suburban.speedKmh), highway: String(DEFAULT_PARTS.highway.speedKmh) });
  const [temp, setTemp] = useState("-5");
  const [gain, setGain] = useState("350");
  const [loss, setLoss] = useState("260");
  const [socStart, setSocStart] = useState("90");
  const [socMin, setSocMin] = useState(String(num("arriveReserveDefaultPct")));
  const [usePersonal, setUsePersonal] = useState(true);
  const [result, setResult] = useState<Forecast | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const k = usePersonal && summary ? summary.personalFactor : 1;

  const request = useMemo(() => {
    if (!vehicle) return null;
    const trip: TripInput = {
      parts: ROADS.map((r) => ({ ...DEFAULT_PARTS[r], km: Number(km[r]) || 0, speedKmh: Number(speed[r]) || 0 }))
        .filter((p) => p.km > 0),
      tempC: Number(temp), elevGainM: Number(gain) || 0, elevLossM: Number(loss) || 0,
    };
    return {
      vehicleId: vehicle.vehicleId, sohPct: vehicle.sohPct, trip, socStartPct: Number(socStart), socArriveMinPct: Number(socMin),
      personalFactor: k, historyRatios: usePersonal && summary ? summary.ratios : undefined, lang: "uk" as const,
    };
  }, [vehicle, km, speed, temp, gain, loss, socStart, socMin, k, usePersonal, summary]);

  useEffect(() => {
    if (!request) return;
    if (!request.trip.parts.length) { setResult(null); setError("Вкажіть довжину хоча б однієї частини поїздки."); return; }
    const timer = setTimeout(() => {
      setLoading(true);
      apiFetch<Forecast>("/forecast", { json: request })
        .then((f) => { setResult(f); setError(""); })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [request]);

  if (!vehicle) {
    return (
      <div className="animate-enter">
        <PageHeader title="Прогноз поїздки" description="Скільки заряду піде на цю поїздку саме у вас, чому стільки і що зміниться, якщо їхати інакше." />
        <Surface>
          <EmptyState icon={CarFront} title="Автомобіль не обрано" detail="Спочатку оберіть модель: прогноз враховує її масу, аеродинаміку і ємність батареї."
            action={<Link href="/vehicle" className="action-secondary" data-testid="link-choose-vehicle">Обрати автомобіль</Link>} />
        </Surface>
      </div>
    );
  }

  const maxAbs = result ? Math.max(result.baseKWh, ...result.contributions.map((c) => Math.abs(c.kWh)), result.energyKWh) : 1;
  const statusView = result && {
    ok: { icon: CheckCircle2, text: `Заряду вистачить: ви прибудете приблизно з ${fmt(result.socArrivePct, 0)} %.`, cls: "border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.07)] text-[hsl(var(--primary))]" },
    tight: { icon: AlertTriangle, text: `Впритул: за песимістичної оцінки ви прибудете з ${fmt(result.socArriveWorstPct, 0)} %, нижче за ваш резерв ${fmt(result.socArriveMinPct, 0)} %.`, cls: "border-[hsl(38_92%_55%/.4)] bg-[hsl(38_92%_55%/.08)] text-[hsl(38_92%_62%)]" },
    insufficient: { icon: AlertTriangle, text: neededPct(result) <= 100
      ? `Заряду не вистачить: виїжджайте щонайменше з ${fmt(neededPct(result), 0)} % або заплануйте зарядну зупинку (очікуваний заряд на прибуття ${fmt(Math.max(0, result.socArrivePct), 0)} %).`
      : `Заряду не вистачить навіть з повною батареєю: поїздка потребує ${fmt(result.socUsedPct, 0)} % батареї, заплануйте зарядну зупинку.`, cls: "border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]" },
  }[result.status];

  return (
    <div className="animate-enter">
      <PageHeader
        title="Прогноз поїздки"
        description="Скільки заряду піде на цю поїздку саме у вас, чому стільки і що зміниться, якщо їхати інакше."
        action={<StatusPill muted={!summary}>{summary ? `Персоналізовано · ${summary.trips} ${plural(summary.trips, ["поїздка", "поїздки", "поїздок"])}` : "Фізична модель · історії ще немає"}</StatusPill>}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[.85fr_1.15fr]">
        <Surface className="p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[12px] font-bold"><CarFront size={15} className="text-[hsl(var(--primary))]" />{vehicle.label}</div>
            <Link href="/vehicle" className="text-[11px] text-dim hover:text-[hsl(var(--primary))]">SoH {fmt(vehicle.sohPct, 0)} % · змінити</Link>
          </div>

          <div className="eyebrow mb-3">Поїздка</div>
          <div className="space-y-3">
            {ROADS.map((r) => (
              <div key={r} className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)] items-end gap-3">
                <div className="pb-3 text-[12px] font-bold">{ROAD_LABEL[r]}</div>
                <NumberInput id={`km-${r}`} label="Відстань" unit="км" value={km[r]} onChange={(v) => setKm((s) => ({ ...s, [r]: v }))} />
                <NumberInput id={`speed-${r}`} label="Сер. швидкість" unit="км/год" value={speed[r]} onChange={(v) => setSpeed((s) => ({ ...s, [r]: v }))} />
              </div>
            ))}
          </div>

          <div className="eyebrow mb-3 mt-6">Умови</div>
          <div className="mb-3"><WeatherHelper onTemp={(t) => setTemp(String(t))} /></div>
          <div className="grid grid-cols-3 gap-3">
            <NumberInput id="temp" label="Повітря" unit="°C" value={temp} onChange={setTemp} />
            <NumberInput id="gain" label="Підйоми" unit="м" value={gain} onChange={setGain} />
            <NumberInput id="loss" label="Спуски" unit="м" value={loss} onChange={setLoss} />
          </div>

          <div className="eyebrow mb-3 mt-6">Батарея</div>
          <div className="grid grid-cols-2 gap-3">
            <NumberInput id="soc-start" label="Заряд на старті" unit="%" value={socStart} onChange={setSocStart} />
            <NumberInput id="soc-min" label="Мінімум на прибуття" unit="%" value={socMin} onChange={setSocMin} />
          </div>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-3">
            <input type="checkbox" checked={usePersonal} onChange={(e) => setUsePersonal(e.target.checked)} data-testid="checkbox-personal" className="mt-0.5 accent-[hsl(var(--primary))]" />
            <span>
              <span className="block text-[12px] font-bold">Враховувати мою історію поїздок</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-dim">
                {summary ? `Персональний коефіцієнт k = ${fmt(summary.personalFactor, 3)} за ${summary.trips} ${plural(summary.trips, ["поїздкою", "поїздками", "поїздками"])}.` : "Поїздок ще немає."}
                {" "}<Link href="/trips" className="text-[hsl(var(--primary))]">Історія поїздок</Link>
              </span>
            </span>
          </label>
        </Surface>

        <div className="space-y-5">
          {error && <Surface className="border-[hsl(var(--destructive)/.35)] p-4 text-[12px] text-[hsl(var(--destructive))]" data-testid="text-forecast-error">{error}</Surface>}

          {!result && !error && (
            <Surface><EmptyState icon={BrainCircuit} title={loading ? "Розрахунок" : "Прогнозу ще немає"} detail="Прогноз оновлюється автоматично, щойно ви змінюєте поїздку." /></Surface>
          )}

          {result && statusView && (
            <>
              <div data-testid="text-forecast-status" className={`flex items-center gap-3 rounded-xl border p-4 text-[12px] font-bold ${statusView.cls}`}>
                <statusView.icon size={17} />{statusView.text}
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  result.socArrivePct >= 0
                    ? { id: "arrival", icon: Gauge, label: "На прибуття", value: `${fmt(result.socArrivePct, 0)} %`, note: `песимістично ${fmt(Math.max(0, result.socArriveWorstPct), 0)} %` }
                    : { id: "arrival", icon: Gauge, label: "На прибуття", value: "0 %", note: `батарея розрядиться приблизно через ${fmt((result.socStartPct / result.socUsedPct) * result.km, 0)} км` },
                  { id: "energy", icon: Zap, label: "Енергія", value: `${fmt(result.energyKWh)} кВт·год`, note: `${fmt(result.energyLowKWh)}–${fmt(result.energyHighKWh)} кВт·год` },
                  { id: "consumption", icon: Sparkles, label: "Споживання", value: `${fmt(result.whPerKm, 0)} Вт·год/км`, note: `${fmt(result.socUsedPct, 0)} % батареї` },
                  { id: "time", icon: Clock, label: "Час у русі", value: hm(result.minutes), note: `${fmt(result.km, 0)} км` },
                ].map((m) => (
                  <Surface key={m.id} className="p-4">
                    <m.icon size={15} className="mb-3 text-[hsl(var(--primary))]" />
                    <div className="eyebrow">{m.label}</div>
                    <div data-testid={`text-forecast-${m.id}`} className="mt-1 text-[20px] font-extrabold tracking-[-.04em]">{m.value}</div>
                    <div className="text-[10px] text-dim">{m.note}</div>
                  </Surface>
                ))}
              </div>

              <Surface className="p-5">
                <div className="mb-1 text-[14px] font-bold">Чому стільки</div>
                <div className="mb-4 text-[10px] text-dim">Внески чинників (значення Шеплі) відносно еталонних умов: {REFERENCE.speedKmh} км/год, +{REFERENCE.tempC} °C, рівна дорога без зупинок, водій як у моделі. Сума смуг точно дорівнює прогнозу.</div>
                <div className="space-y-2" data-testid="chart-contributions">
                  {[{ label: "Еталонні умови", kWh: result.baseKWh, socPct: (result.baseKWh / result.energyKWh) * result.socUsedPct, kind: "base" as const },
                    ...result.contributions.map((c) => ({ ...c, label: cap(c.label), kind: "delta" as const })),
                    { label: "Ваш прогноз", kWh: result.energyKWh, socPct: result.socUsedPct, kind: "total" as const }].map((row) => (
                    <div key={row.label} className="grid grid-cols-[104px_1fr_76px] items-center gap-2 text-[11px] sm:grid-cols-[150px_1fr_110px] sm:gap-3">
                      <span className={row.kind === "delta" ? "text-dim" : "font-bold"}>{row.label}</span>
                      <div className="h-4 rounded bg-[hsl(var(--secondary)/.6)]">
                        <div className={`h-4 rounded ${row.kind === "total" ? "bg-[hsl(var(--primary))]" : row.kind === "base" ? "bg-[hsl(var(--muted-foreground)/.45)]" : row.kWh >= 0 ? "bg-[hsl(var(--primary)/.55)]" : "bg-[hsl(200_80%_60%/.6)]"}`}
                          style={{ width: `${Math.max(1.5, (Math.abs(row.kWh) / maxAbs) * 100)}%` }} />
                      </div>
                      <span className="text-right font-mono">{row.kind === "delta" ? signed(row.kWh, 2) : fmt(row.kWh, 2)} кВт·год</span>
                    </div>
                  ))}
                </div>
                {result.explanation.length > 0 && (
                  <ul className="mt-5 space-y-2 border-t border-[hsl(var(--border))] pt-4" data-testid="list-explanation">
                    {result.explanation.map((s) => <li key={s} className="text-[12px] leading-5">{s}</li>)}
                  </ul>
                )}
              </Surface>

              <Surface className="overflow-hidden">
                <div className="border-b border-[hsl(var(--border))] px-5 py-4 text-[14px] font-bold">Що буде, якщо</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]" data-testid="table-what-if">
                    <thead className="text-dim">
                      <tr className="border-b border-[hsl(var(--border))]">
                        <th className="px-5 py-2 text-left font-semibold">Сценарій</th>
                        <th className="px-3 py-2 text-right font-semibold">Енергія</th>
                        <th className="px-3 py-2 text-right font-semibold">Зміна</th>
                        <th className="px-3 py-2 text-right font-semibold">Час</th>
                        <th className="px-5 py-2 text-right font-semibold">На прибуття</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.whatIf.map((w) => (
                        <tr key={w.id} className="border-b border-[hsl(var(--border)/.6)] last:border-0">
                          <td className="px-5 py-3">{w.label}</td>
                          <td className="px-3 py-3 text-right font-mono">{fmt(w.energyKWh)} кВт·год</td>
                          <td className={`px-3 py-3 text-right font-mono ${w.deltaKWh < 0 ? "text-[hsl(var(--primary))]" : ""}`}>{signed(w.deltaKWh)} кВт·год</td>
                          <td className="px-3 py-3 text-right font-mono">{w.deltaMinutes === 0 ? "—" : `${signed(w.deltaMinutes, 0)} хв`}</td>
                          <td className="px-5 py-3 text-right font-mono">{fmt(w.socArrivePct, 0)} %</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Surface>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
