// Огляд: поточний автомобіль, стан персональної моделі, оцінка запасу ходу, останні поїздки і збережені маршрути
import { Activity, ArrowRight, BatteryCharging, BrainCircuit, CarFront, CheckCircle2, Circle, History, Route as RouteIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { num } from "@workspace/energy";
import { MetricCard, PageHeader, SectionTitle, StatusPill, Surface } from "@/components/kit";
import { apiFetch } from "@/lib/api";
import { useSession, useTrips, useVehicle } from "@/lib/storage";
import { usePersonalization } from "@/lib/use-energy";
import { personalFactors, rangeKm, tripKmOf, vehicleParams, SOURCE_LABEL } from "@/lib/model";
import { day, fmt, hm, plural } from "@/lib/format";

interface SavedPlan { id: number; fromCity: string; toCity: string; km: number; totalMinutes: number; arriveSocPct: number; createdAt: string }

export function DashboardPage() {
  const user = useSession();
  const vehicle = useVehicle();
  const trips = useTrips(vehicle?.vehicleId);
  const { summary } = usePersonalization(vehicle, trips);
  const [routes, setRoutes] = useState<SavedPlan[]>([]);
  const [cities, setCities] = useState<Record<string, string>>({});

  useEffect(() => {
    apiFetch<SavedPlan[]>("/me/routes").then(setRoutes).catch(() => undefined);
    apiFetch<{ cities: { id: string; name: string }[] }>("/route/cities").then((r) => setCities(Object.fromEntries(r.cities.map((c) => [c.id, c.name])))).catch(() => undefined);
  }, []);

  const p = vehicleParams(vehicle);
  const k = personalFactors(summary);
  const minTrips = num("safetyMinTrips");
  const reliable = summary?.reliableTrips ?? 0;
  const steps = [
    { done: !!vehicle, title: "Оберіть автомобіль і стан батареї", href: "/vehicle", note: vehicle ? vehicle.label : "модель з довідника і SoH" },
    { done: reliable >= minTrips, title: `Додайте щонайменше ${minTrips} поїздок`, href: "/trips", note: `${reliable} з ${minTrips} надійних: після цього прогноз і запас σ підлаштовуються під вас` },
    { done: false, title: "Спрогнозуйте поїздку", href: "/prediction", note: "скільки заряду піде і чому" },
    { done: routes.length > 0, title: "Сплануйте маршрут між містами", href: "/routes", note: routes.length ? `збережено планів: ${routes.length}` : "зарядні зупинки з урахуванням надійності станцій" },
  ];
  const recent = [...trips].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const rows = new Map(summary?.rows.map((r) => [r.id, r]) ?? []);

  return (
    <div className="animate-enter">
      <PageHeader title={user?.name ? `Вітаємо, ${user.name}` : "Огляд"} description="Персональний прогноз енергоспоживання електромобіля і планування маршрутів із заряджанням."
        action={<StatusPill muted={!summary}>{summary ? `Модель персоналізовано · k = ${fmt(summary.personalFactor, 3)}` : "Модель без персоналізації"}</StatusPill>} />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={CarFront} label="Автомобіль" value={vehicle ? `${fmt(vehicle.sohPct, 0)} %` : "—"} note={vehicle ? `${vehicle.label} · стан батареї` : "ще не обрано"} href="/vehicle" accent={!!vehicle} testId="vehicle" />
        <MetricCard icon={History} label="Поїздки" value={String(trips.length)} note={summary ? `${summary.reliableTrips} для навчання` : "історії ще немає"} href="/trips" testId="trips" />
        <MetricCard icon={BrainCircuit} label="Похибка прогнозу" value={summary ? `${fmt(summary.mapePersonalLast10Pct ?? summary.mapePersonalPct)} %` : "—"} note={summary ? `без історії ${fmt(summary.mapeModelPct)} %` : "з'явиться після поїздок"} href="/models" testId="mape" />
        <MetricCard icon={BatteryCharging} label="Запас ходу трасою" value={p ? `${fmt(rangeKm(p, "highway", 0, k.highway), 0)} км` : "—"} note={p ? `за 0 °C; за +20 °C ${fmt(rangeKm(p, "highway", 20, k.highway), 0)} км` : "потрібен автомобіль"} href="/battery" testId="range" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <Surface className="p-5">
          <SectionTitle>З чого почати</SectionTitle>
          <ol className="space-y-2" data-testid="list-steps">
            {steps.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="flex items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-3 transition-colors hover:border-[hsl(var(--primary)/.4)]">
                  {s.done ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" /> : <Circle size={16} className="mt-0.5 shrink-0 text-dim" />}
                  <span className="min-w-0 flex-1"><span className="block text-[12px] font-bold">{s.title}</span><span className="block text-[10px] text-dim">{s.note}</span></span>
                  <ArrowRight size={14} className="mt-0.5 text-dim" />
                </Link>
              </li>
            ))}
          </ol>
        </Surface>

        <div className="space-y-5">
          <Surface className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
              <span className="flex items-center gap-2 text-[14px] font-bold"><Activity size={15} className="text-[hsl(var(--primary))]" />Останні поїздки</span>
              <Link href="/trips" className="text-[11px] text-dim hover:text-[hsl(var(--primary))]">усі</Link>
            </div>
            {recent.length === 0 ? (
              <div className="px-5 py-6 text-[11px] text-dim">Поїздок ще немає.</div>
            ) : (
              <table className="w-full text-[11px]" data-testid="table-recent-trips">
                <tbody>
                  {recent.map((t) => {
                    const r = rows.get(t.id);
                    return (
                      <tr key={t.id} className="border-b border-[hsl(var(--border)/.6)] last:border-0">
                        <td className="px-5 py-2.5 font-mono">{day(t.date)}</td>
                        <td className="px-3 py-2.5 font-mono">{fmt(tripKmOf(t))} км</td>
                        <td className="px-3 py-2.5 font-mono">{fmt(t.actualKWh, 2)} кВт·год</td>
                        <td className="px-3 py-2.5 text-dim">{SOURCE_LABEL[t.source]}</td>
                        <td className="px-5 py-2.5 text-right font-mono">{r ? `похибка ${fmt(r.errorPersonalPct)} %` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Surface>

          <Surface className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
              <span className="flex items-center gap-2 text-[14px] font-bold"><RouteIcon size={15} className="text-[hsl(var(--primary))]" />Збережені маршрути</span>
              <Link href="/routes" className="text-[11px] text-dim hover:text-[hsl(var(--primary))]">спланувати</Link>
            </div>
            {routes.length === 0 ? (
              <div className="px-5 py-6 text-[11px] text-dim">Збережених планів ще немає.</div>
            ) : (
              <ul className="divide-y divide-[hsl(var(--border)/.6)]">
                {routes.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-5 py-2.5 text-[11px]">
                    <span><b>{cities[r.fromCity] ?? r.fromCity} → {cities[r.toCity] ?? r.toCity}</b><span className="ml-2 text-dim">{day(r.createdAt)}</span></span>
                    <span className="font-mono">{fmt(r.km, 0)} км · {hm(r.totalMinutes)} · {fmt(r.arriveSocPct, 0)} %</span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
          {trips.length > 0 && (
            <div className="text-[10px] text-dim">
              У вашій історії {trips.length} {plural(trips.length, ["поїздка", "поїздки", "поїздок"])}{trips.some((t) => t.source === "simulator") ? `, з них змодельованих: ${trips.filter((t) => t.source === "simulator").length}` : ""}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
