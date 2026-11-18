// Вхід, реєстрація і сторінка облікового запису (експорт і видалення даних)
import { ArrowRight, Download, LogOut, Trash2, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Field, Notice, PageHeader, SectionTitle, Surface } from "@/components/kit";
import { deleteAccount, login, logout, register, saveTrips, useAppState, useSession, useVehicle } from "@/lib/storage";
import { plural } from "@/lib/format";

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const isLogin = mode === "login";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!isLogin && password.length < 8) return setError("Пароль має містити щонайменше 8 символів.");
    if (!isLogin && password !== confirm) return setError("Паролі не збігаються.");
    setBusy(true);
    try {
      if (isLogin) await login(email, password); else await register(email, password, name.trim());
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="app-noise flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-5">
      <div className="grid w-full max-w-[960px] overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_30px_100px_rgba(0,0,0,.38)] md:grid-cols-[.9fr_1.1fr]">
        <div className="grid-signal hidden flex-col justify-between border-r border-[hsl(var(--border))] p-9 md:flex">
          <span className="flex items-center gap-3">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--primary)/.09)]">
              <span className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--primary))]" />
            </span>
            <span className="text-[15px] font-extrabold tracking-[-.04em]">EV<span className="text-[hsl(var(--primary))]">Predict</span></span>
          </span>
          <div>
            <div className="mb-4 font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary))]">Енергія і маршрути електромобіля</div>
            <div className="max-w-xs text-[28px] font-extrabold leading-[1.1] tracking-[-.05em]">Скільки заряду піде саме у вас.</div>
            <p className="mt-5 max-w-xs text-[12px] leading-6 text-dim">
              Персональний прогноз енергоспоживання за історією ваших поїздок і маршрути між містами України із зарядними зупинками.
            </p>
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[.14em] text-dim">EVPredict</div>
        </div>

        <form className="p-7 sm:p-10" onSubmit={submit}>
          <div className="mb-8 text-[15px] font-extrabold md:hidden">EV<span className="text-[hsl(var(--primary))]">Predict</span></div>
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary))]">{isLogin ? "Вхід" : "Реєстрація"}</div>
          <h1 className="text-[26px] font-extrabold tracking-[-.05em]">{isLogin ? "Увійдіть в EVPredict" : "Створіть обліковий запис"}</h1>
          <p className="mt-2 text-[12px] leading-5 text-dim">
            {isLogin ? "Ваш автомобіль, історія поїздок і плани маршрутів зберігаються в обліковому записі." : "Дані зберігаються на сервері, тому доступні з будь-якого пристрою."}
          </p>

          <div className="mt-7 space-y-4">
            {!isLogin && <Field label="Ім'я (необов'язково)" id="auth-name" value={name} onChange={setName} placeholder="Як до вас звертатися" />}
            <Field label="Електронна пошта" id="auth-email" type="email" value={email} onChange={setEmail} placeholder="name@example.com" />
            <Field label="Пароль" id="auth-password" type="password" value={password} onChange={setPassword} placeholder={isLogin ? "Ваш пароль" : "Щонайменше 8 символів"} />
            {!isLogin && <Field label="Повторіть пароль" id="auth-confirm-password" type="password" value={confirm} onChange={setConfirm} />}
          </div>

          <button type="submit" className="action-primary mt-6 w-full" data-testid="button-auth-submit" disabled={busy || !email || !password}>
            {busy ? "Зачекайте…" : isLogin ? "Увійти" : "Зареєструватися"}
            <ArrowRight size={14} />
          </button>

          {error && <div className="mt-4"><Notice tone="error" testId="text-auth-error">{error}</Notice></div>}

          <div className="mt-7 text-center text-[11px] text-dim">
            {isLogin ? "Ще немає облікового запису?" : "Уже маєте обліковий запис?"}{" "}
            <Link href={isLogin ? "/register" : "/login"} data-testid="link-auth-switch" className="font-bold text-[hsl(var(--primary))]">
              {isLogin ? "Зареєструватися" : "Увійти"}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export const LoginPage = () => <AuthPage mode="login" />;
export const RegisterPage = () => <AuthPage mode="register" />;

export function ProfilePage() {
  const user = useSession();
  const vehicle = useVehicle();
  const allTrips = useAppState((s) => s.trips);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");
  const total = Object.values(allTrips).reduce((s, t) => s + t.length, 0);
  const current = vehicle ? allTrips[vehicle.vehicleId]?.length ?? 0 : 0;

  return (
    <div className="animate-enter">
      <PageHeader title="Обліковий запис" description="Ваші дані зберігаються в базі даних EVPredict. Тут їх можна вивантажити або видалити." />

      <div className="grid max-w-4xl gap-5">
        <Surface className="p-5 md:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] text-dim"><UserRound size={20} /></div>
              <div>
                <div className="text-[15px] font-bold" data-testid="text-profile-name">{user?.name || user?.email}</div>
                <div className="text-[11px] text-dim" data-testid="text-profile-email">{user?.email}</div>
              </div>
            </div>
            <button type="button" className="action-secondary" data-testid="button-logout" onClick={() => void logout()}><LogOut size={14} />Вийти</button>
          </div>
          <div className="mt-5 text-[11px] text-dim">
            У базі: {total} {plural(total, ["поїздка", "поїздки", "поїздок"])} для {Object.keys(allTrips).length} {plural(Object.keys(allTrips).length, ["автомобіля", "автомобілів", "автомобілів"])}.
          </div>
        </Surface>

        <Surface className="p-5 md:p-7">
          <SectionTitle note="Файл JSON з автомобілями, усіма поїздками, персональними моделями і збереженими планами маршрутів.">Вивантажити дані</SectionTitle>
          <a href={`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/me/export`} download="evpredict-export.json" className="action-secondary inline-flex" data-testid="link-export"><Download size={14} />Завантажити JSON</a>
        </Surface>

        <Surface className="p-5 md:p-7">
          <SectionTitle note={vehicle ? `Видаляє ${current} ${plural(current, ["поїздку", "поїздки", "поїздок"])} автомобіля ${vehicle.label} і скидає персональну модель до параметрів довідника.` : "Спочатку оберіть автомобіль."}>Очистити історію поїздок</SectionTitle>
          {!confirmClear ? (
            <button type="button" className="action-secondary" data-testid="button-clear-history" disabled={!vehicle || !current} onClick={() => setConfirmClear(true)}><Trash2 size={14} />Очистити історію</button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12px]">Видалити історію без можливості відновлення?</span>
              <button type="button" className="action-primary" data-testid="button-confirm-clear" onClick={() => { saveTrips(vehicle!.vehicleId, []); setConfirmClear(false); setMessage("Історію очищено."); }}>Так, очистити</button>
              <button type="button" className="action-ghost" onClick={() => setConfirmClear(false)}>Скасувати</button>
            </div>
          )}
          {message && <div className="mt-3 text-[11px] text-[hsl(var(--primary))]">{message}</div>}
        </Surface>

        <Surface className="border-[hsl(var(--destructive)/.3)] p-5 md:p-7">
          <SectionTitle note="Обліковий запис і всі пов'язані дані буде остаточно видалено з бази.">Видалити обліковий запис</SectionTitle>
          {!confirmDelete ? (
            <button type="button" className="action-ghost text-[hsl(var(--destructive))]" data-testid="button-delete-account" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />Видалити обліковий запис</button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12px]">Остаточно видалити обліковий запис і всі дані?</span>
              <button type="button" className="action-primary bg-[hsl(var(--destructive))]" data-testid="button-confirm-delete" onClick={() => void deleteAccount().catch((e: Error) => setMessage(e.message))}>Так, видалити</button>
              <button type="button" className="action-ghost" onClick={() => setConfirmDelete(false)}>Скасувати</button>
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
