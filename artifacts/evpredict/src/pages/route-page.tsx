// Рекомендація маршруту між містами з зарядними зупинками: EVPredict поруч із простим планувальником (Дейкстра,
// постійне споживання). Станції – знімок відкритого набору Open Charge Map, не дані реального часу.
import { AlertTriangle, BatteryCharging, CarFront, CheckCircle2, Clock, MapPinned, PlugZap, Route as RouteIcon, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import type { City, RouteOption, RoutePlanResult } from "@workspace/energy";
import { num, safetyFromHistory } from "@workspace/energy";
import { EmptyState, NumberInput, PageHeader, SelectField, StatusPill, Surface } from "@/components/kit";
import { apiFetch } from "@/lib/api";
import { useTrips, useVehicle } from "@/lib/storage";
import { usePersonalization } from "@/lib/use-energy";
import { day, dayTime, fmt, hm, nextHourLocal, plural, signed, windFrom } from "@/lib/format";

interface CitiesResponse { cities: City[]; stations: number; snapshot: string }
interface WeatherPoint { time: string; tempC: number; windMs: number; windFromDeg: number; source: "forecast" | "archive" }
interface Conditions {
  tempC: number; headWindMs: number; departure: string; weatherRequested: boolean; weatherAvailable: boolean;
  weather: { from: WeatherPoint; to: WeatherPoint; bearingDeg: number } | null;
  relief: boolean; fromElevM: number | null; toElevM: number | null;
}
type PlanResponse = RoutePlanResult & { from: City; to: City; dcCapable: boolean; ownStations: number; snapshot: string; safetyFactor: number; conditions: Conditions };
interface SavedPlan { id: number; fromCity: string; toCity: string; km: number; totalMinutes: number; chargeMinutes: number; minSocPct: number; arriveSocPct: number; tempC: number; risky: boolean; createdAt: string; vehicleId: string }

const stopsCount = (o: RouteOption) => o.stops.length - 2;
const stopsWord = (n: number) => plural(n, ["зарядна зупинка", "зарядні зупинки", "зарядних зупинок"]);

/** Схематична карта: проєкція координат на площину, без підкладки */
function RouteSketch({ plan }: { plan: PlanResponse }) {
  const pts = [plan.from, plan.to, ...plan.corridorStations];
  const lat0 = Math.min(...pts.map((p) => p.lat)), lat1 = Math.max(...pts.map((p) => p.lat));
  const lon0 = Math.min(...pts.map((p) => p.lon)), lon1 = Math.max(...pts.map((p) => p.lon));
  const kx = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
  const w = Math.max((lon1 - lon0) * kx, 0.01), h = Math.max(lat1 - lat0, 0.01);
  const W = 640, H = Math.min(360, Math.max(180, (W * h) / w)), pad = 24;
  const s = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
  const xy = (p: { lat: number; lon: number }) => [pad + (p.lon - lon0) * kx * s, H - pad - (p.lat - lat0) * s] as const;
  const line = (o: RouteOption) => o.stops.map((st) => xy(st).join(",")).join(" ");
  const rhoMin = num("minReliability") * 100;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" data-testid="svg-route-sketch" role="img" aria-label="Схема маршруту">
      {plan.corridorStations.map((c, i) => {
        const [x, y] = xy(c);
        if (c.own) return <rect key={i} x={x - 3.5} y={y - 3.5} width={7} height={7} transform={`rotate(45 ${x} ${y})`} fill="hsl(38 92% 62%)" />;
        return <circle key={i} cx={x} cy={y} r={2.2} fill={c.reliabilityPct >= rhoMin ? "hsl(var(--muted-foreground) / .55)" : "hsl(var(--destructive) / .6)"} />;
      })}
      {plan.baseline.found && <polyline points={line(plan.baseline)} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="6 5" />}
      {plan.evpredict.found && <polyline points={line(plan.evpredict)} fill="none" stroke="hsl(var(--primary))" strokeWidth={3} />}
      {plan.evpredict.stops.filter((st) => st.kind === "station").map((st) => { const [x, y] = xy(st); return <circle key={st.nodeId} cx={x} cy={y} r={5.5} fill="hsl(var(--primary))" />; })}
      {plan.baseline.stops.filter((st) => st.kind === "station").map((st) => { const [x, y] = xy(st); return <rect key={st.nodeId} x={x - 4} y={y - 4} width={8} height={8} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={1.6} />; })}
      {[plan.from, plan.to].map((c) => { const [x, y] = xy(c); return (
        <g key={c.id}><circle cx={x} cy={y} r={6} fill="hsl(var(--foreground))" /><text x={x + 9} y={y + 4} fontSize={12} fontWeight={700} fill="hsl(var(--foreground))">{c.name}</text></g>
      ); })}
    </svg>
  );
}

function OptionCard({ title, subtitle, option, highlight, reservePct, testId }: { title: string; subtitle: string; option: RouteOption; highlight?: boolean; reservePct: number; testId: string }) {
  if (!option.found) {
    return (
      <Surface className="p-5" data-testid={`card-${testId}`}>
        <div className="text-[14px] font-bold">{title}</div>
        <div className="mb-3 text-[10px] text-dim">{subtitle}</div>
        <div className="text-[12px] text-dim">Допустимого плану немає ні зі станціями відкритого реєстру, ні з вашими точками заряду. Якщо знаєте, де зарядитися в дорозі (дім, знайома розетка), додайте точку на сторінці «Зарядні станції».</div>
      </Surface>
    );
  }
  const stranded = option.minSocPct < 0;
  const below = !stranded && option.minSocPct < reservePct - 1e-6;
  return (
    <Surface className={`p-5 ${highlight ? "border-[hsl(var(--primary)/.45)]" : ""}`} data-testid={`card-${testId}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-bold">{title}</div>
          <div className="text-[10px] text-dim">{subtitle}</div>
        </div>
        {option.risky && <StatusPill>Без запасу на невизначеність</StatusPill>}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 text-[11px]">
        <div><div className="eyebrow">Загальний час</div><div className="mt-1 text-[17px] font-extrabold" data-testid={`text-${testId}-time`}>{hm(option.totalMinutes)}</div><div className="text-dim">заряджання {fmt(option.chargeMinutes, 0)} хв</div></div>
        <div><div className="eyebrow">Зупинки</div><div className="mt-1 text-[17px] font-extrabold">{stopsCount(option)}</div><div className="text-dim">{fmt(option.km, 0)} км{option.climbM > 0 ? ` · ↑${fmt(option.climbM, 0)} м` : ""}</div></div>
        <div><div className="eyebrow">Найменший заряд</div><div className={`mt-1 text-[17px] font-extrabold ${stranded || below ? "text-[hsl(var(--destructive))]" : ""}`} data-testid={`text-${testId}-min-soc`}>{stranded ? "0 %" : `${fmt(option.minSocPct, 0)} %`}</div><div className="text-dim">за прогнозом EVPredict</div></div>
      </div>
      {(stranded || below) && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.08)] p-3 text-[11px] text-[hsl(var(--destructive))]" data-testid={`text-${testId}-warning`}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {stranded ? "З цим автомобілем, погодою і вашим стилем водіння батарея, за прогнозом, розрядиться на одній з ділянок." : `Заряд, за прогнозом, опуститься нижче вашого резерву ${fmt(reservePct, 0)} %.`}
        </div>
      )}
      <ol className="mt-4 space-y-2 border-t border-[hsl(var(--border))] pt-4">
        {option.stops.map((st) => (
          <li key={st.nodeId + st.kmFromStart} className="grid grid-cols-[56px_1fr] gap-3 text-[11px]">
            <span className="font-mono text-dim">{fmt(st.kmFromStart, 0)} км</span>
            <span>
              <span className="font-bold">{st.kind === "station" ? (st.title || "Зарядна станція") : st.kind === "origin" ? "Старт" : "Прибуття"}</span>
              {st.kind === "station" && (st.own
                ? <span className="text-dim" data-testid="text-own-stop"> · моя точка · {fmt(st.maxKw ?? 0, 1)} кВт {st.ac ? "AC" : "DC"}</span>
                : <span className="text-dim"> · {st.town} · {fmt(st.maxKw ?? 0, 0)} кВт · надійність {fmt(st.reliabilityPct ?? 0, 0)} %</span>)}
              <span className="block text-dim">
                {st.kind === "origin" ? `виїзд з ${fmt(st.socArrivePct, 0)} %` : `прибуття з ${st.socArrivePct < 0 ? "0" : fmt(st.socArrivePct, 0)} %`}
                {st.chargeToPct !== undefined && ` → зарядити до ${fmt(st.chargeToPct, 0)} % (${fmt(st.chargeMinutes ?? 0, 0)} хв)`}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Surface>
  );
}

export function RoutePlannerPage() {
  const vehicle = useVehicle();
  const trips = useTrips(vehicle?.vehicleId);
  const { summary } = usePersonalization(vehicle, trips);
  const [meta, setMeta] = useState<CitiesResponse | null>(null);
  const [fromId, setFromId] = useState("kyiv");
  const [toId, setToId] = useState("lviv");
  const [temp, setTemp] = useState("");
  const [useWeather, setUseWeather] = useState(true);
  const [departure, setDeparture] = useState(nextHourLocal);
  const [socStart, setSocStart] = useState("90");
  const [reserve, setReserve] = useState(String(num("arriveReserveDefaultPct")));
  const [usePersonal, setUsePersonal] = useState(true);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedPlan[]>([]);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved">("");

  const loadSaved = useCallback(() => { apiFetch<SavedPlan[]>("/me/routes").then(setSaved).catch(() => undefined); }, []);
  useEffect(() => {
    apiFetch<CitiesResponse>("/route/cities").then(setMeta).catch((e: Error) => setError(e.message));
    loadSaved();
  }, [loadSaved]);

  const roadFactorsOk = !!summary && summary.reliableTrips >= num("safetyMinTrips");
  const request = useMemo(() => {
    if (!vehicle || (!useWeather && temp === "")) return null;
    const dep = new Date(departure);
    return {
      vehicleId: vehicle.vehicleId, sohPct: vehicle.sohPct, fromId, toId, socStartPct: Number(socStart), reservePct: Number(reserve),
      tempC: temp !== "" ? Number(temp) : undefined, useWeather, departure: Number.isNaN(dep.getTime()) ? undefined : dep.toISOString(),
      personalFactor: usePersonal && summary ? summary.personalFactor : 1,
      roadFactors: usePersonal && roadFactorsOk ? summary!.roadFactors : undefined,
      safetyFactor: usePersonal && summary ? safetyFromHistory(summary.personalFactor, summary.ratios) : undefined,
    };
  }, [vehicle, fromId, toId, socStart, reserve, temp, useWeather, departure, usePersonal, summary, roadFactorsOk]);

  useEffect(() => {
    if (!request) return;
    setSaveState("");
    if (request.fromId === request.toId) { setPlan(null); setError("Оберіть два різні міста."); return; }
    const timer = setTimeout(() => {
      setLoading(true);
      apiFetch<PlanResponse>("/route/plan", { json: request })
        .then((p) => { setPlan(p); setError(""); })
        .catch((e: Error) => { setPlan(null); setError(e.message); })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [request]);

  const savePlan = async () => {
    if (!request) return;
    setSaveState("saving");
    try { await apiFetch("/me/routes", { json: request }); setSaveState("saved"); loadSaved(); }
    catch (e) { setSaveState(""); setError((e as Error).message); }
  };

  const cityName = (id: string) => meta?.cities.find((c) => c.id === id)?.name ?? id;
  const header = (
    <PageHeader title="Маршрути із заряджанням" description="Зарядні зупинки між містами України з урахуванням вашого автомобіля, погоди і стилю водіння, поруч із простим планувальником з постійним споживанням."
      action={meta ? <StatusPill muted>Open Charge Map · {meta.stations} станцій · знімок {day(meta.snapshot)}</StatusPill> : undefined} />
  );

  if (!vehicle) {
    return (
      <div className="animate-enter">
        {header}
        <Surface><EmptyState icon={CarFront} title="Автомобіль не обрано" detail="Маршрут залежить від ємності батареї, роз'ємів і потужності заряджання вашого автомобіля."
          action={<Link href="/vehicle" className="action-secondary">Обрати автомобіль</Link>} /></Surface>
      </div>
    );
  }

  const cities = (meta?.cities ?? []).map((c) => ({ value: c.id, label: c.name }));
  const ev = plan?.evpredict, bl = plan?.baseline;
  const reserveNum = Number(reserve);

  return (
    <div className="animate-enter">
      {header}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[.7fr_1.3fr]">
        <div className="space-y-5">
          <Surface className="p-5 md:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[12px] font-bold"><CarFront size={15} className="text-[hsl(var(--primary))]" />{vehicle.label}</div>
              <Link href="/vehicle" className="text-[11px] text-dim hover:text-[hsl(var(--primary))]">SoH {fmt(vehicle.sohPct, 0)} % · змінити</Link>
            </div>
            <div className="eyebrow mb-3 flex items-center gap-2"><MapPinned size={13} />Поїздка</div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField id="from" label="Звідки" value={fromId} onChange={setFromId}>{cities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</SelectField>
              <SelectField id="to" label="Куди" value={toId} onChange={setToId}>{cities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</SelectField>
            </div>
            <div className="eyebrow mb-3 mt-6">Умови</div>
            <label className="block">
              <span className="label">Час виїзду</span>
              <input type="datetime-local" data-testid="input-route-departure" value={departure} onChange={(e) => setDeparture(e.target.value)} className="field" />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumberInput id="route-soc" label="Заряд на старті" unit="%" value={socStart} onChange={setSocStart} />
              <NumberInput id="route-reserve" label="Резерв" unit="%" value={reserve} onChange={setReserve} />
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-3">
              <input type="checkbox" checked={useWeather} onChange={(e) => setUseWeather(e.target.checked)} data-testid="checkbox-route-weather" className="mt-0.5 accent-[hsl(var(--primary))]" />
              <span>
                <span className="block text-[12px] font-bold">Погода за прогнозом</span>
                <span className="mt-0.5 block text-[10px] leading-4 text-dim">Температура і вітер на час виїзду в пункті відправлення і на час прибуття в пункті призначення (Open-Meteo).</span>
              </span>
            </label>
            {(!useWeather || (plan?.conditions.weatherRequested && !plan.conditions.weatherAvailable) || error.toLowerCase().includes("прогноз")) && (
              <div className="mt-3"><NumberInput id="route-temp" label={useWeather ? "Температура, якщо прогноз недоступний" : "Температура повітря"} unit="°C" value={temp} onChange={setTemp} /></div>
            )}
            <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-3">
              <input type="checkbox" checked={usePersonal} onChange={(e) => setUsePersonal(e.target.checked)} data-testid="checkbox-route-personal" className="mt-0.5 accent-[hsl(var(--primary))]" />
              <span>
                <span className="block text-[12px] font-bold">Враховувати мою історію поїздок</span>
                <span className="mt-0.5 block text-[10px] leading-4 text-dim">
                  {summary ? `k = ${fmt(summary.personalFactor, 3)} за ${summary.trips} ${plural(summary.trips, ["поїздкою", "поїздками", "поїздками"])}${roadFactorsOk ? ", окремо за типами доріг" : ""}.` : "Поїздок ще немає, тому використовується споживання за моделлю."}
                </span>
              </span>
            </label>
            <div className="mt-6 space-y-2 rounded-lg bg-[hsl(var(--secondary)/.5)] p-3 text-[10px] leading-4 text-dim">
              <p><b className="text-[hsl(var(--foreground))]">EVPredict</b>: споживання за фізичною моделлю з урахуванням температури, швидкості і вашого коефіцієнта k; запас на невизначеність σ; станції з низьким індексом надійності не використовуються; додатковий резерв на під'їзд до станції на випадок, якщо вона не працює.</p>
              <p><b className="text-[hsl(var(--foreground))]">Простий планувальник</b>: алгоритм Дейкстри з паспортним споживанням за +{num("baselineTemp")} °C і {num("baselineSpeed")} км/год, заряджання до {fmt(num("baselineChargeTo") * 100, 0)} % на кожній зупинці, усі станції вважаються робочими.</p>
              <p>Відстані дорівнюють прямій, помноженій на коефіцієнт звивистості {fmt(num("circuity"), 2)}. Стан станцій узято зі знімка відкритих даних, а не в реальному часі.</p>
            </div>
          </Surface>

          <Surface className="p-5">
            <div className="mb-3 text-[13px] font-bold">Збережені плани</div>
            {saved.length === 0 ? (
              <div className="text-[11px] text-dim" data-testid="text-saved-empty">Збережених планів ще немає.</div>
            ) : (
              <ul className="space-y-2" data-testid="list-saved-routes">
                {saved.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-[11px]">
                    <span><b>{cityName(p.fromCity)} → {cityName(p.toCity)}</b><span className="block text-dim">{day(p.createdAt)} · {fmt(p.tempC, 0)} °C · {fmt(p.km, 0)} км</span></span>
                    <span className="text-right font-mono">{hm(p.totalMinutes)}<span className="block text-dim">прибуття {fmt(p.arriveSocPct, 0)} %</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>

        <div className="space-y-5">
          {error && <Surface className="border-[hsl(var(--destructive)/.35)] p-4 text-[12px] text-[hsl(var(--destructive))]" data-testid="text-route-error">{error}</Surface>}
          {!plan && !error && <Surface><EmptyState icon={RouteIcon} title={loading ? "Побудова плану" : "Маршруту ще немає"} detail="План оновлюється автоматично, щойно ви змінюєте поїздку." /></Surface>}
          {plan && !plan.dcCapable && (
            <Surface className="flex items-start gap-3 p-4 text-[12px]" data-testid="text-route-no-dc">
              <PlugZap size={16} className="mt-0.5 shrink-0 text-[hsl(38_92%_62%)]" />
              {plan.ownStations
                ? "Цей автомобіль не підтримує швидке заряджання постійним струмом, тому з реєстру станцій нічого не підходить; для заряджання в дорозі використовуються лише ваші власні AC-точки."
                : "Цей автомобіль не підтримує швидке заряджання постійним струмом, тому можлива лише пряма поїздка. Для міжміських маршрутів використовуються станції постійного струму з реєстру; власні точки заряду (дім, знайома розетка) можна додати на сторінці «Зарядні станції»."}
            </Surface>
          )}
          {plan && ev && bl && (
            <>
              {ev.found && (
                <div data-testid="text-route-summary" className="flex flex-col gap-3 rounded-xl border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.07)] p-4 text-[12px] font-bold text-[hsl(var(--primary))] sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-3">
                    <CheckCircle2 size={17} className="shrink-0" />
                    <span>
                      {`${stopsCount(ev)} ${stopsWord(stopsCount(ev))}, прибуття з ${fmt(ev.arriveSocPct, 0)} %. `}
                      {bl.found
                        ? bl.minSocPct < reserveNum
                          ? `Простий план ${ev.totalMinutes >= bl.totalMinutes ? "коротший" : "довший"} на ${fmt(Math.abs(ev.totalMinutes - bl.totalMinutes), 0)} хв, але заряд у ньому, за прогнозом, падає до ${bl.minSocPct < 0 ? "0" : fmt(bl.minSocPct, 0)} %.`
                          : `Різниця з простим планом: ${ev.totalMinutes >= bl.totalMinutes ? "+" : "−"}${fmt(Math.abs(ev.totalMinutes - bl.totalMinutes), 0)} хв.`
                        : "Простий планувальник плану не знайшов."}
                    </span>
                  </span>
                  <button type="button" className="action-secondary shrink-0" data-testid="button-save-route" disabled={saveState !== ""} onClick={() => void savePlan()}>
                    <Save size={14} />{saveState === "saved" ? "Збережено" : saveState === "saving" ? "Збереження…" : "Зберегти план"}
                  </button>
                </div>
              )}
              <Surface className="p-4 text-[11px] leading-5" data-testid="text-route-conditions">
                <div className="mb-1 font-bold">Умови розрахунку</div>
                {plan.conditions.weather ? (
                  <div>
                    {plan.from.name}: {signed(plan.conditions.weather.from.tempC, 0)} °C, вітер {fmt(plan.conditions.weather.from.windMs, 0)} м/с {windFrom(plan.conditions.weather.from.windFromDeg)} ({dayTime(plan.conditions.weather.from.time)}) ·{" "}
                    {plan.to.name}: {signed(plan.conditions.weather.to.tempC, 0)} °C, вітер {fmt(plan.conditions.weather.to.windMs, 0)} м/с {windFrom(plan.conditions.weather.to.windFromDeg)} ({dayTime(plan.conditions.weather.to.time)}).
                    <span className="block text-dim">У розрахунку: {signed(plan.conditions.tempC, 1)} °C, {plan.conditions.headWindMs >= 0 ? "зустрічний" : "попутний"} вітер {fmt(Math.abs(plan.conditions.headWindMs), 1)} м/с уздовж напрямку руху.</span>
                  </div>
                ) : (
                  <div>{plan.conditions.weatherRequested ? "Прогноз погоди недоступний, використано вказану температуру" : "Температура задана вручну"}: {signed(plan.conditions.tempC, 1)} °C, без урахування вітру.</div>
                )}
                <div className="text-dim">
                  {plan.conditions.relief && plan.conditions.fromElevM !== null && plan.conditions.toElevM !== null
                    ? `Рельєф: ${plan.from.name} ${fmt(plan.conditions.fromElevM, 0)} м, ${plan.to.name} ${fmt(plan.conditions.toElevM, 0)} м над рівнем моря; різниця висот між зупинками врахована в енергії кожної ділянки.`
                    : "Рельєф не враховано, ділянки розраховано як рівні."}
                </div>
                <div className="mt-1 text-[10px] text-dim">Дані: погода – Open-Meteo.com; висоти – Copernicus DEM GLO-90 (ESA).</div>
              </Surface>
              <Surface className="p-4">
                <RouteSketch plan={plan} />
                <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-dim">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-5 bg-[hsl(var(--primary))]" />EVPredict</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-[hsl(var(--muted-foreground))]" />Простий планувальник</span>
                  <span className="flex items-center gap-1.5"><BatteryCharging size={12} />{plan.stationsInCorridor} сумісних {plan.ownStations ? "станцій і власних точок" : "DC-станцій"} у смузі {plan.corridorKm} км від прямої</span>
                  {plan.corridorStations.some((c) => c.own) && <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rotate-45 bg-[hsl(38_92%_62%)]" />мої точки заряду</span>}
                  <span className="flex items-center gap-1.5"><Clock size={12} />час заряджання враховує {num("connectMinutes")} хв на підключення</span>
                </div>
              </Surface>
              {(!usePersonal || !roadFactorsOk) && (
                <div className="rounded-md border border-[hsl(var(--border))] px-4 py-3 text-xs text-dim" data-testid="cold-start-note">
                  Запас σ = {fmt(num("safetyDefault"), 2)} – консервативна оцінка, поки історії поїздок немає або вона не враховується:
                  у калібруванні такий запас покриває 90 % водіїв. Після {num("safetyMinTrips")} поїздок із надійними показами SoC
                  (і з увімкненим урахуванням історії) його замінить ваш власний запас.
                  Позначка «Без запасу на невизначеність» означає, що з цим запасом маршрут не проходить, а не що він неможливий.
                </div>
              )}
              <div className="grid gap-5 lg:grid-cols-2">
                <OptionCard title="EVPredict" subtitle={`Персональне споживання, надійність станцій, запас σ = ${fmt(plan.safetyFactor, 2)}`} option={ev} highlight reservePct={reserveNum} testId="evpredict" />
                <OptionCard title="Простий планувальник" subtitle={`Дейкстра · паспортне споживання · заряджання до ${fmt(num("baselineChargeTo") * 100, 0)} %`} option={bl} reservePct={reserveNum} testId="baseline" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
