// Профіль водія: персональні коефіцієнти, розкид фактичного споживання відносно моделі, запас σ та інтервал прогнозу,
// структура пробігу. Усі показники обчислено з історії поїздок поточного автомобіля.
import { Activity, CarFront, Gauge, History, ShieldCheck, Sigma } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, list, predictionInterval, safetyFromHistory } from "@workspace/energy";
import { EmptyState, MetricCard, PageHeader, SectionTitle, StatusPill, Surface } from "@/components/kit";
import { useTrips, useVehicle } from "@/lib/storage";
import { usePersonalization } from "@/lib/use-energy";
import { ROADS, ROAD_LABEL, roadKmOf, tripKmOf } from "@/lib/model";
import { fmt, plural, signed } from "@/lib/format";

const axis = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };
const tooltip = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 };
const vsModel = (k: number) => (k >= 1 ? `на ${fmt((k - 1) * 100, 0)} % більше за модель` : `на ${fmt((1 - k) * 100, 0)} % менше за модель`);

export function BehaviorPage() {
  const vehicle = useVehicle();
  const trips = useTrips(vehicle?.vehicleId);
  const { summary, error } = usePersonalization(vehicle, trips);

  const mix = useMemo(() => {
    const km = Object.fromEntries(ROADS.map((r) => [r, trips.reduce((s, t) => s + roadKmOf(t, r), 0)])) as Record<string, number>;
    const speed = Object.fromEntries(ROADS.map((r) => {
      const parts = trips.flatMap((t) => t.trip.parts.filter((p) => p.type === r && p.km > 0));
      const dist = parts.reduce((s, p) => s + p.km, 0), hours = parts.reduce((s, p) => s + p.km / p.speedKmh, 0);
      return [r, hours > 0 ? dist / hours : NaN];
    })) as Record<string, number>;
    const total = trips.reduce((s, t) => s + tripKmOf(t), 0);
    const temp = trips.length ? trips.reduce((s, t) => s + t.trip.tempC, 0) / trips.length : NaN;
    return { km, speed, total, temp };
  }, [trips]);

  // розподіл відношення «факт / модель» з кроком 0,05
  const histogram = useMemo(() => {
    if (!summary) return [];
    const bins = new Map<number, number>();
    for (const r of summary.ratios) { const b = Math.round(r * 20) / 20; bins.set(b, (bins.get(b) ?? 0) + 1); }
    const keys = [...bins.keys()];
    if (!keys.length) return [];
    const out = [];
    for (let b = Math.min(...keys); b <= Math.max(...keys) + 1e-9; b = Math.round((b + 0.05) * 100) / 100) out.push({ b: fmt(b, 2), n: bins.get(b) ?? 0 });
    return out;
  }, [summary]);

  const header = (
    <PageHeader title="Профіль водія" description="Як ваш стиль водіння і умови поїздок відрізняються від моделі. Ці коефіцієнти використовуються в прогнозі та плануванні маршрутів."
      action={<StatusPill muted={!summary}>{summary ? `${summary.trips} ${plural(summary.trips, ["поїздка", "поїздки", "поїздок"])}` : "Профіль порожній"}</StatusPill>} />
  );

  if (!vehicle) {
    return <div className="animate-enter">{header}<Surface><EmptyState icon={CarFront} title="Автомобіль не обрано" detail="Профіль водія будується окремо для кожного автомобіля." action={<Link href="/vehicle" className="action-secondary">Обрати автомобіль</Link>} /></Surface></div>;
  }
  if (!summary) {
    return (
      <div className="animate-enter">{header}
        <Surface><EmptyState icon={History} title={error ? "Не вдалося обчислити профіль" : "Поїздок ще немає"} detail={error || "Профіль з'явиться після перших поїздок: додайте їх вручну, імпортуйте CSV або згенеруйте тестові."}
          action={<Link href="/trips" className="action-secondary" data-testid="link-behavior-trips">Історія поїздок</Link>} /></Surface>
      </div>
    );
  }

  const enough = summary.reliableTrips >= num("safetyMinTrips");
  const sigma = safetyFromHistory(summary.personalFactor, summary.ratios);
  const [lo, hi] = predictionInterval(summary.personalFactor, summary.ratios);
  const [qLo, qHi] = list("intervalQuantiles");
  const kChart = summary.rows.map((r, i) => ({ n: i + 1, k: +r.kAfter.toFixed(3) }));

  return (
    <div className="animate-enter">
      {header}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Activity} label="Персональний коефіцієнт k" value={fmt(summary.personalFactor, 3)} note={`ви витрачаєте ${vsModel(summary.personalFactor)}`} accent testId="k" />
        <MetricCard icon={ShieldCheck} label="Надійні поїздки" value={`${summary.reliableTrips} з ${summary.trips}`} note={`зниження заряду щонайменше ${num("minSocDropPct")} %`} testId="reliable" />
        <MetricCard icon={Sigma} label="Запас σ для маршрутів" value={fmt(sigma, 2)} note={enough ? `квантиль ${fmt(num("safetyQuantile"), 1)} вашої історії` : `типовий, доки надійних поїздок менше ${num("safetyMinTrips")}`} testId="sigma" />
        <MetricCard icon={Gauge} label="Інтервал прогнозу" value={`${signed((lo - 1) * 100, 0)}…${signed((hi - 1) * 100, 0)} %`} note={summary.ratios.length >= num("intervalMinTrips") ? `квантилі ${fmt(qLo, 1)} і ${fmt(qHi, 1)} відносно k` : "типовий, історії замало"} testId="interval" />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <Surface className="p-5">
          <SectionTitle note={enough ? "Оцінено гребеневою регресією за поїздками з різною часткою міста і траси." : `З'являться, коли надійних поїздок буде ${num("safetyMinTrips")}; до того використовується спільний k.`}>Коефіцієнти за типами доріг</SectionTitle>
          <div className="space-y-4" data-testid="list-road-factors">
            {ROADS.map((r) => {
              const v = enough ? summary.roadFactors[r] : summary.personalFactor;
              return (
                <div key={r}>
                  <div className="mb-1 flex justify-between text-[12px]"><span className="font-bold">{ROAD_LABEL[r]}</span><span className="font-mono">{fmt(v, 3)}</span></div>
                  <div className="relative h-2 rounded bg-[hsl(var(--secondary)/.7)]">
                    <div className="absolute top-0 h-2 rounded bg-[hsl(var(--primary)/.8)]" style={{ left: "0%", width: `${Math.min(100, (v / 2) * 100)}%` }} />
                    <div className="absolute -top-1 h-4 w-px bg-[hsl(var(--foreground))]" style={{ left: "50%" }} title="k = 1, як у моделі" />
                  </div>
                  <div className="mt-1 text-[10px] text-dim">{vsModel(v)}</div>
                </div>
              );
            })}
          </div>
        </Surface>
        <Surface className="p-5">
          <SectionTitle note="Відношення фактичної енергії до прогнозу моделі без персоналізації за надійними поїздками. Вертикальна лінія – ваш k.">Розкид споживання відносно моделі</SectionTitle>
          <div className="h-[220px]" data-testid="chart-ratios">
            <ResponsiveContainer>
              <BarChart data={histogram} margin={{ left: -14, right: 12 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="b" tick={axis} />
                <YAxis allowDecimals={false} tick={axis} />
                <Tooltip contentStyle={tooltip} formatter={(v) => [`${v}`, "поїздок"]} />
                <ReferenceLine x={fmt(Math.round(summary.personalFactor * 20) / 20, 2)} stroke="hsl(var(--foreground))" />
                <Bar isAnimationActive={false} dataKey="n" fill="hsl(var(--primary) / .75)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Surface>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Surface className="p-5">
          <SectionTitle note={`Згладжування з коефіцієнтом α = ${fmt(num("ewmaAlpha"), 2)} після кожної надійної поїздки.`}>Як навчався коефіцієнт k</SectionTitle>
          <div className="h-[220px]" data-testid="chart-k">
            <ResponsiveContainer>
              <LineChart data={kChart} margin={{ left: -6, right: 12 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="n" tick={axis} />
                <YAxis domain={["auto", "auto"]} tick={axis} tickFormatter={(v: number) => fmt(v, 2)} />
                <Tooltip contentStyle={tooltip} labelFormatter={(n) => `Поїздка ${n}`} />
                <ReferenceLine y={1} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                <Line isAnimationActive={false} type="monotone" dataKey="k" name="k" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Surface>
        <Surface className="overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] px-5 py-4 text-[14px] font-bold">Структура пробігу</div>
          <table className="w-full text-[11px]" data-testid="table-mix">
            <thead className="text-dim">
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="px-5 py-2 text-left font-semibold">Тип дороги</th>
                <th className="px-3 py-2 text-right font-semibold">Пробіг</th>
                <th className="px-3 py-2 text-right font-semibold">Частка</th>
                <th className="px-5 py-2 text-right font-semibold">Сер. швидкість</th>
              </tr>
            </thead>
            <tbody>
              {ROADS.map((r) => (
                <tr key={r} className="border-b border-[hsl(var(--border)/.6)]">
                  <td className="px-5 py-2.5">{ROAD_LABEL[r]}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(mix.km[r], 0)} км</td>
                  <td className="px-3 py-2.5 text-right font-mono">{mix.total > 0 ? `${fmt((mix.km[r] / mix.total) * 100, 0)} %` : "—"}</td>
                  <td className="px-5 py-2.5 text-right font-mono">{Number.isFinite(mix.speed[r]) ? `${fmt(mix.speed[r], 0)} км/год` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 text-[10px] leading-4 text-dim">
            Усього {fmt(mix.total, 0)} км, середня поїздка {fmt(mix.total / trips.length, 1)} км, середня температура повітря {fmt(mix.temp, 0)} °C.
          </div>
        </Surface>
      </div>
    </div>
  );
}
