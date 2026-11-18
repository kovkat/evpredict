// Спільні елементи інтерфейсу сторінок: заголовок, панель, порожній стан, показник, поле введення
import { ArrowUpRight, Battery, Database } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-5 border-b border-[hsl(var(--border))] pb-7 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="text-[30px] font-extrabold tracking-[-.055em] text-[hsl(var(--foreground))] md:text-[38px]">
          {title}
        </h1>

        {description && (
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-dim">
            {description}
          </p>
        )}
      </div>

      {action}
    </div>
  );
}

export function Surface({
  children,
  className = "",
  ...props
}: {
  children: ReactNode;
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <section className={`surface rounded-xl ${className}`} {...props}>
      {children}
    </section>
  );
}

export function EmptyState({
  icon: Icon = Database,
  title,
  detail,
  action,
}: {
  icon?: typeof Database;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[190px] flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)] text-[hsl(var(--muted-foreground))]">
        <Icon size={19} strokeWidth={1.5} />
      </div>

      <div
        data-testid="text-empty"
        className="text-[13px] font-bold text-[hsl(var(--foreground))]"
      >
        {title}
      </div>

      <div className="mt-1 max-w-sm text-[11px] leading-5 text-dim">
        {detail}
      </div>

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  accent = false,
  href,
  testId,
}: {
  icon: typeof Battery;
  label: string;
  value: string;
  note: string;
  accent?: boolean;
  href?: string;
  testId?: string;
}) {
  const body = (
    <div
      className={`surface group rounded-xl p-5 transition-transform duration-200 hover:-translate-y-0.5 ${
        href ? "cursor-pointer" : ""
      }`}
    >
      <div className="mb-8 flex items-start justify-between">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
            accent
              ? "border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"
              : "border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.7)] text-[hsl(var(--muted-foreground))]"
          }`}
        >
          <Icon size={17} strokeWidth={1.7} />
        </div>

        {href && (
          <ArrowUpRight
            size={15}
            className="text-[hsl(var(--muted-foreground))] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          />
        )}
      </div>

      <div className="eyebrow !tracking-[.12em]">{label}</div>

      <div
        data-testid={testId ? `text-metric-${testId}` : undefined}
        className={`mt-2 text-[28px] font-extrabold tracking-[-.06em] ${
          accent
            ? "text-[hsl(var(--primary))]"
            : "text-[hsl(var(--foreground))]"
        }`}
      >
        {value}
      </div>

      <div className="mt-1 text-[11px] text-dim">{note}</div>
    </div>
  );

  return href ? (
    <Link href={href} data-testid={testId ? `link-metric-${testId}` : undefined}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatusPill({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.55)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.1em] text-dim">
      <span className={`status-dot ${muted ? "muted" : ""}`} />
      {children}
    </span>
  );
}

export function Field({
  label,
  id,
  placeholder,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  id: string;
  placeholder?: string;
  type?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>

      <input
        id={id}
        data-testid={`input-${id}`}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className="field"
      />
    </label>
  );
}

export function SelectField({
  label,
  id,
  children,
  value,
  onChange,
}: {
  label: string;
  id: string;
  children: ReactNode;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>

      <select
        id={id}
        data-testid={`select-${id}`}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className="select-field"
      >
        {children}
      </select>
    </label>
  );
}

export function NumberInput({ id, label, unit, value, onChange, hint }: { id: string; label: string; unit?: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}{unit ? <span className="font-normal"> · {unit}</span> : null}</span>
      <input id={id} data-testid={`input-${id}`} type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="field" />
      {hint && <span className="mt-1 block text-[10px] text-dim">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = "info", children, testId }: { tone?: "info" | "ok" | "warn" | "error"; children: ReactNode; testId?: string }) {
  const cls = {
    info: "border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.5)] text-dim",
    ok: "border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.07)] text-[hsl(var(--primary))]",
    warn: "border-[hsl(38_92%_55%/.4)] bg-[hsl(38_92%_55%/.08)] text-[hsl(38_92%_62%)]",
    error: "border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]",
  }[tone];
  return <div data-testid={testId} className={`rounded-lg border p-3 text-[11px] leading-5 ${cls}`}>{children}</div>;
}

/** Невелика таблиця «назва – значення» для карток */
export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-[hsl(var(--border))] p-3">
          <div className="eyebrow mb-1">{k}</div>
          <div className="font-mono text-[12px]">{v}</div>
        </div>
      ))}
    </div>
  );
}

export function SectionTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[14px] font-bold">{children}</div>
      {note && <div className="mt-0.5 text-[10px] leading-4 text-dim">{note}</div>}
    </div>
  );
}
