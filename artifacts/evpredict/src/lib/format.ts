// Форматування чисел для українського інтерфейсу: десяткова кома, типографський мінус, без «−0»
export function fmt(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "—";
  let s = x.toFixed(digits);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace(".", ",").replace("-", "−");
}

export const signed = (x: number, digits = 1) => `${x >= 0 ? "+" : "−"}${fmt(Math.abs(x), digits)}`;

/** Тривалість у хвилинах як «1 год 05 хв» */
export function hm(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} год ${String(m % 60).padStart(2, "0")} хв` : `${m} хв`;
}

/** Дата ISO як «18.11.2026» */
export const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("uk-UA");
};

/** Узгодження іменника з числом: plural(5, ["поїздка", "поїздки", "поїздок"]) */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

/** Напрямок, звідки дме вітер, словами: windFrom(270) = "із заходу" */
export function windFrom(deg: number): string {
  const names = ["з півночі", "з північного сходу", "зі сходу", "з південного сходу", "з півдня", "з південного заходу", "із заходу", "з північного заходу"];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Значення для поля datetime-local: найближча наступна повна година за місцевим часом */
export function nextHourLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Дата і час як «18.11, 22:00» */
export const dayTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}, ${d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`;
};
