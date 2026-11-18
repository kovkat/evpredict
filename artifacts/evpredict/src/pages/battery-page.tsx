// Батарея: стан і доступна ємність, запас ходу за моделлю з урахуванням персональних коефіцієнтів,
// фактичне споживання і енергія за історією поїздок.
import { BatteryCharging, BatteryFull, CarFront, Gauge, RefreshCcw } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { DEFAULT_PARTS, num } from "@workspace/energy";
import { EmptyState, MetricCard, Notice, PageHeader, SectionTitle, StatusPill, Surface } from "@/components/kit";
import { useTrips, useVehicle } from "@/lib/storage";
import { usePersonalization } from "@/lib/use-energy";
import { ROADS, ROAD_LABEL, personalFactors, rangeKm, tripKmOf, vehicleParams } from "@/lib/model";
import { fmt, plural } from "@/lib/format";

const axis = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };
const tooltip = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 };
const COLORS: Record<string, string> = { city: "hsl(200 80% 62%)", suburban: "hsl(38 92% 60%)", highway: "hsl(var(--primary))" };
const TEMPS = [-20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35];
const TABLE_TEMPS = [-10, 0, 10, 20, 30];

export function BatteryPage() {
  const vehicle = useVehicle();
  const trips = useTrips(vehicle?.vehicleId);
  const { summary } = usePersonalization(vehicle, trips);
  const p = vehicleParams(vehicle);
  const k = personalFactors(summary);
  const reserve = num("arriveReserveDefaultPct");

  const rangeCurve = useMemo(() => (p ? TEMPS.map((t) => ({ t, ...Object.fromEntries(ROADS.map((r) => [r, Math.round(rangeKm(p, r, t, k[r], reserve))])) })) : []), [p, k, reserve]);

  // фактичне питоме споживання поїздок і його залежність від температури повітря
  const consumption = useMemo(() => trips.filter((r) => r.actualKWh > 0 && tripKmOf(r) > 0)
    .map((r) => ({ t: r.trip.tempC, wh: (r.actualKWh * 1000) / tripKmOf(r), km: tripKmOf(r), sim: r.source === "simulator" })), [trips]);
  const byTemp = useMemo(() => {
    const bins = new Map<number, { sum: number; km: number; n: number }>();
    for (const c of consumption) {
      const b = Math.floor(c.t / 10) * 10;
      const x = bins.get(b) ?? { sum: 0, km: 0, n: 0 };
      x.sum += c.wh * c.km; x.km += c.km; x.n += 1;
      bins.set(b, x);
    }
    return [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([b, x]) => ({ bin: `${fmt(b, 0)}…${fmt(b + 10, 0)} °C`, wh: Math.round(x.sum / x.km), n: x.n }));
  }, [consumption]);

  if (!vehicle || !p) {
    return (
      <div className="animate-enter">
        <PageHeader title="Батарея" description="Стан батареї, доступна ємність і запас ходу з урахуванням погоди та вашого стилю водіння." />
        <Surface><EmptyState icon={CarFront} title="Автомобіль не обрано" detail="Оберіть модель і вкажіть стан батареї." action={<Link href="/vehicle" className="action-secondary">Обрати автомобіль</Link>} /></Surface>
      </div>
    );
  }

  const availableKWh = p.usableKWh;
  const totalKWh = trips.reduce((s, r) => s + r.actualKWh, 0);
  const totalKm = trips.reduce((s, r) => s + tripKmOf(r), 0);
  const cycles = totalKWh / availableKWh;
  const simulated = trips.filter((r) => r.source === "simulator").length;
  const avgWh = totalKm > 0 ? (totalKWh * 1000) / totalKm : NaN;

  return (
    <div className="animate-enter">
      <PageHeader
        title="Батарея"
        description="Стан батареї, доступна ємність і запас ходу з урахуванням погоди та вашого стилю водіння."
        action={<StatusPill muted={!summary}>{summary ? `Персоналізовано · ${summary.reliableTrips} ${plural(summary.reliableTrips, ["надійна поїздка", "надійні поїздки", "надійних поїздок"])}` : "Фізична модель"}</StatusPill>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={BatteryFull} label="Стан батареї (SoH)" value={`${fmt(vehicle.sohPct, 0)} %`} note="задано вручну за діагностикою" href="/vehicle" accent testId="soh" />
        <MetricCard icon={BatteryCharging} label="Доступна ємність" value={`${fmt(availableKWh)} кВт·год`} note={`з ${fmt(vehicle.usableKWh)} кВт·год нової батареї`} testId="capacity" />
        <MetricCard icon={RefreshCcw} label="Еквівалентні цикли" value={fmt(cycles, 1)} note={`${fmt(totalKWh, 0)} кВт·год за ${trips.length} ${plural(trips.length, ["поїздку", "поїздки", "поїздок"])}`} testId="cycles" />
        <MetricCard icon={Gauge} label="Середнє споживання" value={Number.isFinite(avgWh) ? `${fmt(avgWh, 0)} Вт·год/км` : "—"} note={totalKm > 0 ? `фактично за ${fmt(totalKm, 0)} км` : "з'явиться після першої поїздки"} testId="avg-consumption" />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.25fr_.75fr]">
        <Surface className="p-5">
          <SectionTitle note={`Оцінка моделі для рівної дороги від повного заряду до резерву ${reserve} %. Швидкості: місто ${DEFAULT_PARTS.city.speedKmh}, приміська ${DEFAULT_PARTS.suburban.speedKmh}, траса ${DEFAULT_PARTS.highway.speedKmh} км/год.${summary ? " Враховано ваші персональні коефіцієнти." : ""}`}>Запас ходу залежно від температури, км</SectionTitle>
          <div className="h-[260px]" data-testid="chart-range">
            <ResponsiveContainer>
              <LineChart data={rangeCurve} margin={{ left: -6, right: 12 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={axis} tickFormatter={(t: number) => `${fmt(t, 0)}°`} />
                <YAxis tick={axis} />
                <Tooltip contentStyle={tooltip} labelFormatter={(t) => `${fmt(Number(t), 0)} °C`} formatter={(v) => `${v} км`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {ROADS.map((r) => <Line key={r} isAnimationActive={false} type="monotone" dataKey={r} name={ROAD_LABEL[r]} stroke={COLORS[r]} dot={false} strokeWidth={2} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Surface>
        <Surface className="overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] px-5 py-4 text-[14px] font-bold">Запас ходу, км</div>
          <table className="w-full text-[11px]" data-testid="table-range">
            <thead className="text-dim">
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="px-5 py-2 text-left font-semibold">Повітря</th>
                {ROADS.map((r) => <th key={r} className="px-3 py-2 text-right font-semibold">{ROAD_LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {TABLE_TEMPS.map((t) => (
                <tr key={t} className="border-b border-[hsl(var(--border)/.6)] last:border-0">
                  <td className="px-5 py-2.5 font-mono">{t > 0 ? "+" : ""}{fmt(t, 0)} °C</td>
                  {ROADS.map((r) => <td key={r} className="px-3 py-2.5 text-right font-mono">{fmt(rangeKm(p, r, t, k[r], reserve), 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 text-[10px] leading-4 text-dim">
            {summary ? `Коефіцієнти: місто ${fmt(k.city, 2)}, приміська ${fmt(k.suburban, 2)}, траса ${fmt(k.highway, 2)}.` : "Без історії поїздок використовується модель без персоналізації (k = 1)."}
          </div>
        </Surface>
      </div>

      {consumption.length === 0 ? (
        <Surface><EmptyState icon={BatteryCharging} title="Фактичних даних ще немає" detail="Після перших поїздок тут з'явиться ваше фактичне споживання залежно від температури."
          action={<Link href="/trips" className="action-secondary">Додати поїздки</Link>} /></Surface>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Surface className="p-5">
            <SectionTitle note={simulated ? `З них змодельовано: ${simulated}.` : "Кожна точка – поїздка з вашої історії."}>Фактичне споживання поїздок, Вт·год/км</SectionTitle>
            <div className="h-[240px]" data-testid="chart-consumption">
              <ResponsiveContainer>
                <ScatterChart margin={{ left: -6, right: 12 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="t" name="Температура" unit=" °C" tick={axis} />
                  <YAxis type="number" dataKey="wh" name="Споживання" tick={axis} />
                  <ZAxis range={[24, 24]} />
                  <Tooltip contentStyle={tooltip} formatter={(v) => fmt(Number(v), 0)} />
                  <Scatter isAnimationActive={false} data={consumption} fill="hsl(var(--primary))" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </Surface>
          <Surface className="p-5">
            <SectionTitle note="Середнє, зважене за пробігом, у діапазонах температури по 10 °C.">Споживання за температурою</SectionTitle>
            <div className="h-[240px]" data-testid="chart-consumption-temp">
              <ResponsiveContainer>
                <BarChart data={byTemp} margin={{ left: -6, right: 12 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="bin" tick={axis} />
                  <YAxis tick={axis} />
                  <Tooltip contentStyle={tooltip} formatter={(v, _n, item) => [`${v} Вт·год/км (${(item.payload as { n: number }).n} поїздок)`, "Споживання"]} />
                  <Bar isAnimationActive={false} dataKey="wh" fill="hsl(var(--primary) / .75)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Surface>
        </div>
      )}

      <div className="mt-5">
        <Notice>
          Стан батареї задається за звітом діагностики. Еквівалентні цикли – енергія з історії поїздок, поділена на доступну ємність; вона показує навантаження на батарею лише за записаними поїздками.
        </Notice>
      </div>
    </div>
  );
}
