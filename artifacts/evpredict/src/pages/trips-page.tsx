import { CarFront, Download, FlaskConical, History, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DEFAULT_PARTS, MIN_SOC_DROP_FOR_LEARNING, type DriverProfile, type RoadType, type TripRecord } from "@workspace/energy";
import { EmptyState, PageHeader, SelectField, StatusPill, Surface } from "@/components/kit";
import { apiFetch } from "@/lib/api";
import { saveTrips, useTrips, useVehicle } from "@/lib/storage";
import { usePersonalization } from "@/lib/use-energy";
import { SOURCE_LABEL } from "@/lib/model";
import { day, fmt, plural } from "@/lib/format";

const PROFILES: Pick<DriverProfile, "id" | "label">[] = [
  { id: "eco", label: "Економний водій" },
  { id: "normal", label: "Типовий водій" },
  { id: "dynamic", label: "Динамічний водій" },
];
const CSV_HEADER = "date,km_city,km_suburban,km_highway,temp_c,elev_gain_m,elev_loss_m,soc_start,soc_end,source";

function makeRecord(id: string, date: string, km: Record<RoadType, number>, tempC: number, gain: number, loss: number,
  socStart: number, socEnd: number, usableKWh: number, source: TripRecord["source"]): TripRecord {
  return {
    id, date, source, socStartPct: socStart, socEndPct: socEnd,
    actualKWh: Math.round(((socStart - socEnd) / 100) * usableKWh * 100) / 100,
    trip: {
      parts: (Object.keys(km) as RoadType[]).filter((t) => km[t] > 0).map((t) => ({ ...DEFAULT_PARTS[t], km: km[t] })),
      tempC, elevGainM: gain, elevLossM: loss,
    },
  };
}

const kmOf = (r: TripRecord, t: RoadType) => r.trip.parts.filter((p) => p.type === t).reduce((s, p) => s + p.km, 0);

export function TripsPage() {
  const vehicle = useVehicle();
  const trips = useTrips(vehicle?.vehicleId);
  const { summary, error: replayError } = usePersonalization(vehicle, trips);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), city: "12", suburban: "0", highway: "0", temp: "5", gain: "40", socStart: "80", socEnd: "68" });
  const [profile, setProfile] = useState("dynamic");
  const [count, setCount] = useState("40");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const capacity = vehicle ? (vehicle.usableKWh * vehicle.sohPct) / 100 : 0;
  const rowsById = useMemo(() => new Map(summary?.rows.map((r) => [r.id, r]) ?? []), [summary]);
  const chart = summary?.rows.map((r, i) => ({ n: i + 1, model: +r.errorModelPct.toFixed(1), personal: +r.errorPersonalPct.toFixed(1), k: +r.kAfter.toFixed(3) })) ?? [];
  const simulated = trips.filter((t) => t.source === "simulator").length;

  if (!vehicle) {
    return (
      <div className="animate-enter">
        <PageHeader title="Історія поїздок" description="За вашими поїздками прогноз дізнається, скільки насправді витрачають ваш автомобіль і ваш стиль водіння." />
        <Surface><EmptyState icon={CarFront} title="Автомобіль не обрано" detail="Історія поїздок ведеться окремо для кожного автомобіля." action={<Link href="/vehicle" className="action-secondary" data-testid="link-choose-vehicle">Обрати автомобіль</Link>} /></Surface>
      </div>
    );
  }

  const addManual = () => {
    const n = (s: string) => Number(s);
    const km = { city: n(form.city) || 0, suburban: n(form.suburban) || 0, highway: n(form.highway) || 0 };
    const s0 = n(form.socStart), s1 = n(form.socEnd);
    if (km.city + km.suburban + km.highway <= 0) return setMessage("Вкажіть пройдену відстань.");
    if (!(s0 > s1) || s0 > 100 || s1 < 0) return setMessage("Заряд наприкінці має бути меншим, ніж на початку (0–100 %).");
    const rec = makeRecord(`manual-${Date.now()}`, new Date(form.date).toISOString(), km, n(form.temp), n(form.gain) || 0, n(form.gain) || 0, s0, s1, capacity, "manual");
    saveTrips(vehicle.vehicleId, [...trips, rec]);
    setMessage("Поїздку додано.");
  };

  const generate = async () => {
    setBusy(true); setMessage("");
    try {
      // синтетичні поїздки датуються в минулому, перед найранішою наявною поїздкою
      const n = Math.min(200, Math.max(1, Number(count) || 20));
      const first = trips.length ? trips.reduce((a, b) => (a.date < b.date ? a : b)).date : new Date().toISOString();
      const startDate = new Date(new Date(first).getTime() - (n * 3.5 + 1) * 86400000).toISOString();
      const recs = await apiFetch<TripRecord[]>("/simulator/trips", {
        json: { vehicleId: vehicle.vehicleId, sohPct: vehicle.sohPct, profileId: profile, count: n,
          seed: Math.floor(Math.random() * 1e6), startDate },
      });
      saveTrips(vehicle.vehicleId, [...trips, ...recs]);
      setMessage(`Додано ${recs.length} ${plural(recs.length, ["змодельовану поїздку", "змодельовані поїздки", "змодельованих поїздок"])}.`);
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };

  const exportCsv = () => {
    const lines = trips.map((r) => [r.date, kmOf(r, "city"), kmOf(r, "suburban"), kmOf(r, "highway"), r.trip.tempC, r.trip.elevGainM, r.trip.elevLossM, r.socStartPct, r.socEndPct, r.source].join(","));
    const url = URL.createObjectURL(new Blob([[CSV_HEADER, ...lines].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `evpredict-trips-${vehicle.vehicleId}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const [head, ...rows] = text.trim().split(/\r?\n/);
    const cols = head.split(",").map((c) => c.trim());
    const idx = (c: string) => cols.indexOf(c);
    if (["date", "km_city", "soc_start", "soc_end", "temp_c"].some((c) => idx(c) < 0)) return setMessage(`Файл CSV має містити стовпці: ${CSV_HEADER}`);
    const recs: TripRecord[] = [];
    rows.forEach((line, i) => {
      const v = line.split(",");
      const g = (c: string) => (idx(c) >= 0 ? Number(v[idx(c)]) || 0 : 0);
      const s0 = g("soc_start"), s1 = g("soc_end");
      if (!(s0 > s1)) return;
      const src = (v[idx("source")] ?? "csv").trim() as TripRecord["source"];
      recs.push(makeRecord(`csv-${Date.now()}-${i}`, new Date(v[idx("date")]).toISOString(),
        { city: g("km_city"), suburban: g("km_suburban"), highway: g("km_highway") }, g("temp_c"), g("elev_gain_m"), idx("elev_loss_m") >= 0 ? g("elev_loss_m") : g("elev_gain_m"),
        s0, s1, capacity, ["manual", "csv", "simulator", "dataset"].includes(src) ? src : "csv"));
    });
    saveTrips(vehicle.vehicleId, [...trips, ...recs]);
    setMessage(`Імпортовано ${recs.length} ${plural(recs.length, ["поїздку", "поїздки", "поїздок"])}.`);
  };

  return (
    <div className="animate-enter">
      <PageHeader
        title="Історія поїздок"
        description="За вашими поїздками прогноз дізнається, скільки насправді витрачають ваш автомобіль і ваш стиль водіння."
        action={<StatusPill muted={!summary}><span data-testid="text-trips-k">{summary ? `k = ${fmt(summary.personalFactor, 3)} · ${summary.trips} ${plural(summary.trips, ["поїздка", "поїздки", "поїздок"])}` : "Поїздок ще немає"}</span></StatusPill>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Surface className="p-5 md:p-6">
          <div className="mb-4 flex items-center gap-2 text-[14px] font-bold"><Plus size={15} className="text-[hsl(var(--primary))]" />Додати поїздку</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["date", "Дата", "date"], ["city", "Місто, км"], ["suburban", "Приміська, км"], ["highway", "Траса, км"], ["temp", "Повітря, °C"], ["gain", "Підйоми, м"], ["socStart", "Заряд на старті, %"], ["socEnd", "Заряд наприкінці, %"]] as const).map(([key, label, type]) => (
              <label key={key} className="block">
                <span className="label">{label}</span>
                <input data-testid={`input-trip-${key}`} type={type ?? "number"} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className="field" />
              </label>
            ))}
          </div>
          <button type="button" className="action-primary mt-5" data-testid="button-add-trip" onClick={addManual}><Plus size={14} />Додати</button>
          <p className="mt-3 text-[10px] leading-4 text-dim">Запишіть заряд з панелі приладів до і після поїздки. Енергія рахується з різниці зарядів і доступної ємності ({fmt(capacity)} кВт·год). Поїздки, на які пішло менше {MIN_SOC_DROP_FOR_LEARNING} % заряду, зберігаються, але не використовуються для навчання: для них покази з кроком 1 % надто грубі.</p>
        </Surface>

        <Surface className="p-5 md:p-6">
          <div className="mb-1 flex items-center gap-2 text-[14px] font-bold"><FlaskConical size={15} className="text-[hsl(var(--primary))]" />Тестові дані із симулятора</div>
          <p className="mb-4 text-[10px] leading-4 text-dim">Генерує поїздки з прихованим стилем водіння, якого система не знає. Так можна перевірити, що прогноз навчається. Змодельовані поїздки завжди позначено.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Профіль водія" id="sim-profile" value={profile} onChange={setProfile}>
              {PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </SelectField>
            <label className="block"><span className="label">Кількість поїздок</span>
              <input data-testid="input-sim-count" type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} className="field" />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="action-primary" data-testid="button-generate-trips" disabled={busy} onClick={generate}><FlaskConical size={14} />{busy ? "Генерування…" : "Згенерувати"}</button>
            <button type="button" className="action-secondary" data-testid="button-import-csv" onClick={() => fileRef.current?.click()}><Upload size={14} />Імпорт CSV</button>
            <button type="button" className="action-secondary" data-testid="button-export-csv" disabled={!trips.length} onClick={exportCsv}><Download size={14} />Експорт CSV</button>
            <button type="button" className="action-ghost text-[hsl(var(--destructive))]" data-testid="button-clear-trips" disabled={!trips.length} onClick={() => saveTrips(vehicle.vehicleId, [])}><Trash2 size={14} />Очистити</button>
            <input ref={fileRef} data-testid="input-import-csv" type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          </div>
        </Surface>
      </div>

      {(message || replayError) && <div data-testid="text-trips-message" className="mb-5 text-[12px] text-[hsl(var(--primary))]">{replayError || message}</div>}

      {!summary ? (
        <Surface><EmptyState icon={History} title="Поїздок ще немає" detail="Додайте свої поїздки або згенеруйте тестові, щоб побачити, як прогноз підлаштовується під вас." /></Surface>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            {[
              ["trips", "Поїздки", `${summary.trips}`, `${summary.reliableTrips} для навчання${simulated ? ` · ${simulated} змодельовано` : ""}`],
              ["k", "Персональний коефіцієнт k", fmt(summary.personalFactor, 3), summary.personalFactor >= 1 ? `ви витрачаєте на ${fmt((summary.personalFactor - 1) * 100, 0)} % більше за модель` : `ви витрачаєте на ${fmt((1 - summary.personalFactor) * 100, 0)} % менше за модель`],
              ["mape-model", "Похибка без історії", `${fmt(summary.mapeModelPct)} %`, "фізична модель, MAPE"],
              ["mape-personal", "Похибка з історією", `${fmt(summary.mapePersonalLast10Pct ?? summary.mapePersonalPct)} %`, summary.mapePersonalLast10Pct !== null ? "останні 10 поїздок, MAPE" : "усі поїздки, MAPE"],
            ].map(([id, label, value, note]) => (
              <Surface key={id} className="p-4">
                <div className="eyebrow">{label}</div>
                <div data-testid={`text-summary-${id}`} className="mt-1 text-[22px] font-extrabold tracking-[-.04em]">{value}</div>
                <div className="text-[10px] text-dim">{note}</div>
              </Surface>
            ))}
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_.6fr]">
            <Surface className="p-5">
              <div className="mb-3 text-[14px] font-bold">Похибка прогнозу для кожної поїздки, %</div>
              <div className="h-[240px]">
                <ResponsiveContainer>
                  <LineChart data={chart} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="n" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="model" name="Без історії" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1.5} />
                    <Line isAnimationActive={false} type="monotone" dataKey="personal" name="З історією" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Surface>
            <Surface className="p-5">
              <div className="mb-3 text-[14px] font-bold">Персональний коефіцієнт k</div>
              <div className="h-[240px]">
                <ResponsiveContainer>
                  <LineChart data={chart} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="n" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => fmt(v, 2)} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="k" name="k" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Surface>
          </div>

          <Surface className="overflow-hidden">
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-[11px]" data-testid="table-trips">
                <thead className="sticky top-0 bg-[hsl(var(--card))] text-dim">
                  <tr className="border-b border-[hsl(var(--border))]">
                    {["Дата", "Джерело", "Відстань", "Повітря", "Прогноз", "Факт", "Похибка", ""].map((h) => <th key={h} className="px-4 py-2 text-left font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...trips].sort((a, b) => b.date.localeCompare(a.date)).map((t) => {
                    const r = rowsById.get(t.id);
                    return (
                      <tr key={t.id} className="border-b border-[hsl(var(--border)/.6)]">
                        <td className="px-4 py-2.5 font-mono">{day(t.date)}</td>
                        <td className="px-4 py-2.5"><span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${t.source === "simulator" ? "border-[hsl(38_92%_55%/.4)] text-[hsl(38_92%_62%)]" : "border-[hsl(var(--border))] text-dim"}`}>{SOURCE_LABEL[t.source]}</span></td>
                        <td className="px-4 py-2.5 font-mono">{fmt(t.trip.parts.reduce((s, p) => s + p.km, 0))} км</td>
                        <td className="px-4 py-2.5 font-mono">{fmt(t.trip.tempC, 0)} °C</td>
                        <td className="px-4 py-2.5 font-mono">{r ? `${fmt(r.predictedKWh, 2)} кВт·год` : "—"}</td>
                        <td className="px-4 py-2.5 font-mono">{fmt(t.actualKWh, 2)} кВт·год</td>
                        <td className="px-4 py-2.5 font-mono">
                          {r ? `${fmt(r.errorPersonalPct)} %` : "—"}
                          {r && !r.reliable && <span className="ml-2 font-sans text-[9px] text-dim" title={`Заряд зменшився менше ніж на ${MIN_SOC_DROP_FOR_LEARNING} %: покази надто грубі для навчання`}>коротка, не для навчання</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button type="button" aria-label="Видалити поїздку" className="action-ghost p-1 text-dim" onClick={() => saveTrips(vehicle.vehicleId, trips.filter((x) => x.id !== t.id))}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Surface>
        </>
      )}
    </div>
  );
}
