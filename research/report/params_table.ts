// Таблиця параметрів моделей і алгоритму з реєстру lib/energy/src/params.ts.
// Запуск: node --experimental-strip-types --no-warnings research/report/params_table.ts
// Результат: research/results/params.md – повна таблиця за групами з походженням кожного значення.
import { mkdirSync, writeFileSync } from "node:fs";
import { PARAMS, type ParamDef, type Group } from "../../lib/energy/src/params.ts";

const GROUPS: Record<Group, string> = {
  physics: "Фізичні сталі і клімат-система", vehicle: "Типові параметри автомобіля", trip: "Типові частини поїздки",
  personalization: "Персоналізація", forecast: "Інтервал прогнозу і запас σ", explanation: "Пояснення значеннями Шеплі",
  "what-if": "Сценарії «що буде, якщо»", reliability: "Індекс надійності станцій", graph: "Граф коридору",
  search: "Пошук плану", charging: "Заряджання", baseline: "Базовий планувальник", replanning: "Перепланування",
};
const PLAN = { sensitivity: "аналіз чутливості (research/sensitivity)" } as const;

const fmt = (x: number) => String(x).replace("-", "−").replace(".", ",");
const value = (p: ParamDef) => (typeof p.value === "number" ? fmt(p.value) : p.value.map(fmt).join("; ")) + (p.unit ? ` ${p.unit}` : "");
const origin = (p: ParamDef) => {
  switch (p.origin) {
    case "physical": return "фізична стала";
    case "regulation": return p.ref! + (p.note ? ` (${p.note})` : "");
    case "literature": return `${p.ref}${p.note ? ` (${p.note})` : ""}`;
    case "derived": return `виведено: ${p.note}${p.ref ? ` [${p.ref}]` : ""}`;
    case "calibrated": return `калібровано: ${p.note}`;
    case "convention": return `статистична домовленість${p.note ? `: ${p.note}` : ""}${p.ref ? ` [${p.ref}]` : ""}`;
    case "definition": return `визначення${p.note ? `: ${p.note}` : ""}`;
    case "provisional": return `без прямого джерела; перевірка – ${PLAN[p.plan!]}`;
  }
};

const all = Object.values(PARAMS) as ParamDef[];
const lines = ["# Параметри моделей і алгоритму EVPredict", "",
  "Згенеровано з `lib/energy/src/params.ts`. Скрипти, з яких виведено значення, – у `research/params`.", ""];
const counts: Record<string, number> = {};
for (const g of Object.keys(GROUPS) as Group[]) {
  const ps = all.filter((p) => p.group === g);
  if (!ps.length) continue;
  lines.push(`## ${GROUPS[g]}`, "", "| Позначення | Параметр | Значення | Походження |", "|---|---|---|---|");
  for (const p of ps) {
    lines.push(`| ${p.symbol || "–"} | ${p.name} | ${value(p)} | ${origin(p)} |`);
    counts[p.origin] = (counts[p.origin] ?? 0) + 1;
  }
  lines.push("");
}
// три рівні обґрунтування: параметри не мають однакової наукової ваги, і таблиця це показує
const CATEGORY: [string, string, string[]][] = [
  ["Фізичні сталі, нормативи, дослідження", "публікації, нормативні документи, фізичні сталі", ["physical", "regulation", "literature"]],
  ["Параметри з даних", "розрахунок за реальними наборами даних (WLTC, OSRM, Open EV Data, OCM) і властивостями моделі", ["derived"]],
  ["Алгоритмічні параметри", "калібрування на синтетиці з перевіркою на VED; аналіз чутливості ±50 %", ["calibrated", "provisional"]],
  ["Визначення і домовленості", "на точність прогнозу не впливають (еталони пояснення, налаштування, статистичні домовленості)", ["definition", "convention"]],
];
lines.push("## Підсумок за рівнем обґрунтування", "", "| Категорія | Метод | Кількість |", "|---|---|---|",
  ...CATEGORY.map(([name, method, os]) => `| ${name} | ${method} | ${os.reduce((s, o) => s + (counts[o] ?? 0), 0)} |`),
  `| Усього | | ${all.length} |`, "", ...Object.entries(counts).map(([k, n]) => `- ${k}: ${n}`), "");
const out = new URL("../results/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}params.md`, lines.join("\n"));
console.log(`${all.length} параметрів → ${out}params.md`, counts);
