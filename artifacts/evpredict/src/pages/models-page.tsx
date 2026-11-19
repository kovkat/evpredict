// Моделі та точність: які моделі працюють у системі, як змінюється похибка прогнозу на вашій історії,
// результати експерименту з плануванням маршрутів і реєстр усіх параметрів з походженням значень.
import { BrainCircuit, CarFront, ChartNoAxesCombined, Route as RouteIcon, Sigma, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FACTORS, PARAMS, factorName, list, num, type ParamDef } from "@workspace/energy";
import { EmptyState, PageHeader, SectionTitle, StatusPill, Surface } from "@/components/kit";
import { useTrips, useVehicle } from "@/lib/storage";
import { usePersonalization } from "@/lib/use-energy";
import { fmt } from "@/lib/format";
// результат експерименту research/benchmark (run.ts → stats.py), зберігається в репозиторії
import benchmarkStats from "../../../../research/benchmark/results/stats.json";
// той самий експеримент у світі з рельєфом і вітром (WORLD=ua → weather_stats.py)
import weatherStats from "../../../../research/benchmark/results/ua_weather_stats.json";

const axis = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };
const tooltip = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 };

const GROUPS: Record<string, string> = {
  physics: "Фізичні сталі і клімат-система", vehicle: "Типові параметри автомобіля", trip: "Типові частини поїздки",
  personalization: "Персоналізація", forecast: "Інтервал прогнозу і запас σ", explanation: "Пояснення",
  "what-if": "Сценарії «що буде, якщо»", reliability: "Індекс надійності станцій", graph: "Граф коридору",
  search: "Пошук плану", charging: "Заряджання", baseline: "Простий планувальник", replanning: "Перепланування",
};
const ORIGIN: Record<ParamDef["origin"], { label: string; cls: string }> = {
  physical: { label: "фізична стала", cls: "text-[hsl(var(--primary))]" },
  regulation: { label: "норматив", cls: "text-[hsl(var(--primary))]" },
  literature: { label: "дослідження", cls: "text-[hsl(var(--primary))]" },
  calibrated: { label: "калібровано", cls: "text-[hsl(var(--primary))]" },
  derived: { label: "виведено", cls: "text-[hsl(var(--primary))]" },
  convention: { label: "статистична домовленість", cls: "text-[hsl(200_80%_65%)]" },
  definition: { label: "визначення", cls: "text-[hsl(200_80%_65%)]" },
  provisional: { label: "аналіз чутливості", cls: "text-[hsl(38_92%_62%)]" },
};
const PLANNERS: Record<string, string> = {
  naive: "Пряма поїздка без енергетичних обмежень", baseline: "Дейкстра з постійним споживанням", physics: "EVPredict: фізична модель",
  personal: "+ персоналізація і запас σ", full: "+ надійність станцій і перепланування",
};

interface WeatherMetrics { success_pct: number; stranded_pct_of_plans: number; below_reserve_pct: number; mean_abs_arrival_err_pp: number }
interface WeatherRow { scenario: string; trips: number; full: WeatherMetrics; weather: WeatherMetrics }
interface BenchRow { tag: string; scenario: string; planner: string; trips: number; success_pct: number; stranded_pct_of_plans: number; below_reserve_pct: number }

const valueOf = (p: ParamDef) => (typeof p.value === "number" ? fmt(p.value, p.value % 1 ? Math.min(4, String(p.value).split(".")[1]?.length ?? 0) : 0) : p.value.map((x) => fmt(x, x % 1 ? 2 : 0)).join("; ")) + (p.unit ? ` ${p.unit}` : "");

export function ModelsPage() {
  const vehicle = useVehicle();
  const trips = useTrips(vehicle?.vehicleId);
  const { summary } = usePersonalization(vehicle, trips);
  const [group, setGroup] = useState("all");

  const params = Object.entries(PARAMS) as [string, ParamDef][];
  const counts = params.reduce<Record<string, number>>((m, [, p]) => { m[p.origin] = (m[p.origin] ?? 0) + 1; return m; }, {});
  const shown = params.filter(([, p]) => group === "all" || p.group === group);

  // ковзна похибка (вікно 10 поїздок) без персоналізації і з нею
  const curve = useMemo(() => {
    if (!summary) return [];
    const rows = summary.rows.filter((r) => r.reliable);
    return rows.map((_, i) => {
      const w = rows.slice(Math.max(0, i - 9), i + 1);
      const m = (f: (r: typeof w[number]) => number) => w.reduce((s, r) => s + Math.abs(f(r)), 0) / w.length;
      return { n: i + 1, model: +m((r) => r.errorModelPct).toFixed(1), personal: +m((r) => r.errorPersonalPct).toFixed(1) };
    });
  }, [summary]);

  const bench = (benchmarkStats as BenchRow[]).filter((r) => r.tag === "base" && r.scenario === "informative");
  const weatherRow = (weatherStats as WeatherRow[]).find((r) => r.scenario === "informative");
  const benchTrips = bench[0]?.trips ?? 0;

  const models = [
    { icon: BrainCircuit, title: "Фізична модель споживання", text: "Енергія з рівняння руху: опір кочення, аеродинамічний опір, розгони і гальмування в потоці (за циклом WLTC), рельєф з рекуперацією, власні потреби і клімат-система залежно від температури. ККД і навантаження – з опублікованих вимірювань; маса і C_d – з даних виробників, площа міделя – оцінка за шириною і висотою; ємність і крива DC-заряджання – з Open EV Data, з урахуванням SoH." },
    { icon: Sparkles, title: "Персоналізація", text: `Коефіцієнт k уточнюється після кожної надійної поїздки експоненційним згладжуванням (α = ${fmt(num("ewmaAlpha"), 2)}), обмеженим межами ${list("ratioClip").map((x) => fmt(x, 1)).join("…")}. Коефіцієнти за типами доріг – гребенева регресія (λ = ${fmt(num("ridgeLambda"), 0)}).` },
    { icon: Sigma, title: "Інтервал і запас σ", text: `Межі прогнозу – квантилі ${list("intervalQuantiles").map((x) => fmt(x, 1)).join(" і ")} відношень «факт / прогноз». Запас для маршрутів σ – квантиль ${fmt(num("safetyQuantile"), 1)}, від ${num("safetyMinTrips")} надійних поїздок.` },
    { icon: ChartNoAxesCombined, title: "Пояснення прогнозу", text: `Точні значення Шеплі за ${FACTORS.length} чинниками: ${FACTORS.map((f) => factorName(f, "uk")).join(", ")}. Сума внесків дорівнює прогнозу.` },
    { icon: RouteIcon, title: "Планувальник маршрутів", text: `Пошук найкоротшого за часом плану з обмеженням на заряд (міткова задача з евристикою A*). Станції – з коридору ${list("corridorStepsKm").join(", ")} км навколо прямої, з індексом надійності не нижче ${fmt(num("minReliability") * 100, 0)} %.` },
  ];

  return (
    <div className="animate-enter">
      <PageHeader title="Моделі та точність" description="Які моделі працюють у системі, наскільки точний прогноз на вашій історії і звідки взято кожен параметр."
        action={<StatusPill>{params.length} параметрів у реєстрі</StatusPill>} />

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {models.map((m) => (
          <Surface key={m.title} className="p-4">
            <m.icon size={16} className="mb-3 text-[hsl(var(--primary))]" />
            <div className="text-[12px] font-bold">{m.title}</div>
            <div className="mt-2 text-[10px] leading-4 text-dim">{m.text}</div>
          </Surface>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Surface className="p-5">
          <SectionTitle note="Середня абсолютна похибка у відсотках за останніми 10 надійними поїздками: прогноз до поїздки порівнюється з фактом.">Точність прогнозу на вашій історії</SectionTitle>
          {!vehicle ? (
            <EmptyState icon={CarFront} title="Автомобіль не обрано" detail="Точність рахується за історією поточного автомобіля." action={<Link href="/vehicle" className="action-secondary">Обрати автомобіль</Link>} />
          ) : !summary || curve.length < 2 ? (
            <EmptyState title="Даних ще замало" detail="Потрібно щонайменше дві надійні поїздки." action={<Link href="/trips" className="action-secondary">Історія поїздок</Link>} />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-6 text-[12px]" data-testid="text-models-mape">
                <span>Без історії: <b className="font-mono">{fmt(summary.mapeModelPct)} %</b></span>
                <span>З історією: <b className="font-mono text-[hsl(var(--primary))]">{fmt(summary.mapePersonalLast10Pct ?? summary.mapePersonalPct)} %</b></span>
              </div>
              <div className="h-[230px]" data-testid="chart-learning">
                <ResponsiveContainer>
                  <LineChart data={curve} margin={{ left: -10, right: 12 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="n" tick={axis} />
                    <YAxis tick={axis} />
                    <Tooltip contentStyle={tooltip} labelFormatter={(n) => `Поїздка ${n}`} formatter={(v) => `${fmt(Number(v))} %`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="model" name="Без історії" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1.5} />
                    <Line isAnimationActive={false} type="monotone" dataKey="personal" name="З історією" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Surface>

        <Surface className="overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] px-5 py-4">
            <div className="text-[14px] font-bold">Експеримент з плануванням маршрутів</div>
            <div className="mt-0.5 text-[10px] leading-4 text-dim">Симуляція {benchTrips} поїздок між містами України зі станціями Open Charge Map і прихованим стилем водіння; скрипт research/benchmark.</div>
          </div>
          <table className="w-full text-[11px]" data-testid="table-benchmark">
            <thead className="text-dim">
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="px-5 py-2 text-left font-semibold">Планувальник</th>
                <th className="px-3 py-2 text-right font-semibold">Успішні</th>
                <th className="px-5 py-2 text-right font-semibold">Розряд у дорозі</th>
              </tr>
            </thead>
            <tbody>
              {bench.map((r) => (
                <tr key={r.planner} className={`border-b border-[hsl(var(--border)/.6)] last:border-0 ${r.planner === "full" ? "font-bold" : ""}`}>
                  <td className="px-5 py-2.5">{PLANNERS[r.planner] ?? r.planner}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(r.success_pct)} %</td>
                  <td className="px-5 py-2.5 text-right font-mono">{fmt(r.stranded_pct_of_plans)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 text-[10px] leading-4 text-dim">«Успішні» – план знайдено і виконано без повного розряду, від усіх поїздок; «розряд у дорозі» – від поїздок, для яких план знайдено.</div>
          {weatherRow && (
            <div className="border-t border-[hsl(var(--border))] px-5 py-4" data-testid="table-weather-benchmark">
              <div className="mb-2 text-[12px] font-bold">Світ з рельєфом і вітром: чи допомагає знати погоду</div>
              <table className="w-full text-[11px]">
                <thead className="text-dim"><tr>
                  <th className="py-1 text-left font-semibold">Показник</th><th className="py-1 text-right font-semibold">Без погоди і рельєфу</th><th className="py-1 text-right font-semibold">З прогнозом і рельєфом</th>
                </tr></thead>
                <tbody className="font-mono">
                  {([["Успішні", "success_pct"], ["Розряд у дорозі", "stranded_pct_of_plans"], ["Заряд нижче резерву", "below_reserve_pct"]] as const).map(([l, k]) => (
                    <tr key={k}><td className="py-1 font-sans">{l}</td><td className="py-1 text-right">{fmt(weatherRow.full[k])} %</td><td className="py-1 text-right">{fmt(weatherRow.weather[k])} %</td></tr>
                  ))}
                  <tr><td className="py-1 font-sans">Похибка заряду на прибуття</td><td className="py-1 text-right">{fmt(weatherRow.full.mean_abs_arrival_err_pp)} п. п.</td><td className="py-1 text-right">{fmt(weatherRow.weather.mean_abs_arrival_err_pp)} п. п.</td></tr>
                </tbody>
              </table>
              <div className="mt-2 text-[10px] leading-4 text-dim">Ті самі {weatherRow.trips} поїздок; висоти міст і станцій реальні (Copernicus DEM), вітер і похибка його прогнозу – параметри синтетичного світу.</div>
            </div>
          )}
        </Surface>
      </div>

      <Surface className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[14px] font-bold">Реєстр параметрів</div>
            <div className="mt-0.5 text-[10px] text-dim">
              {Object.entries(counts).map(([o, n]) => `${ORIGIN[o as ParamDef["origin"]].label}: ${n}`).join(" · ")}. Попередні значення використовуються до калібрування.
            </div>
          </div>
          <select className="select-field md:w-64" value={group} onChange={(e) => setGroup(e.target.value)} data-testid="select-param-group">
            <option value="all">Усі групи</option>
            {Object.entries(GROUPS).map(([g, l]) => <option key={g} value={g}>{l}</option>)}
          </select>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-[11px]" data-testid="table-params">
            <thead className="sticky top-0 bg-[hsl(var(--card))] text-dim">
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="px-5 py-2 text-left font-semibold">Позначення</th>
                <th className="px-3 py-2 text-left font-semibold">Параметр</th>
                <th className="px-3 py-2 text-right font-semibold">Значення</th>
                <th className="px-5 py-2 text-left font-semibold">Походження</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(([id, p]) => (
                <tr key={id} className="border-b border-[hsl(var(--border)/.6)]">
                  <td className="px-5 py-2 font-mono">{p.symbol || "–"}</td>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{valueOf(p)}</td>
                  <td className="px-5 py-2"><span className={ORIGIN[p.origin].cls}>{ORIGIN[p.origin].label}</span>
                    <span className="text-dim">{p.origin === "provisional" ? " · прямого джерела немає, вплив перевірено зміною ±50 %" : p.ref ? ` · ${p.ref}` : p.note ? ` · ${p.note}` : ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  );
}
