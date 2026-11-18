import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  BrainCircuit,
  CarFront,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  History,
  LayoutDashboard,
  Menu,
  PlugZap,
  Route as RouteIcon,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useSession, useSyncError, useVehicle } from "@/lib/storage";

const primaryNavigation = [
  { href: "/dashboard", label: "Огляд", icon: LayoutDashboard, id: "dashboard" },
  { href: "/vehicle", label: "Автомобіль", icon: CarFront, id: "vehicle" },
  { href: "/battery", label: "Батарея", icon: BatteryCharging, id: "battery" },
  { href: "/prediction", label: "Прогноз поїздки", icon: BrainCircuit, id: "prediction" },
  { href: "/trips", label: "Історія поїздок", icon: History, id: "trips" },
  { href: "/behavior", label: "Профіль водія", icon: Activity, id: "behavior" },
  { href: "/routes", label: "Маршрути", icon: RouteIcon, id: "routes" },
  { href: "/charging", label: "Зарядні станції", icon: PlugZap, id: "charging" },
];

const toolsNavigation = [
  { href: "/models", label: "Моделі та точність", icon: ChartNoAxesCombined, id: "models" },
];

function NavItem({
  href,
  label,
  id,
  icon: Icon,
  collapsed,
  onNavigate,
}: {
  href: string;
  label: string;
  id: string;
  icon: typeof LayoutDashboard;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const [location] = useLocation();
  const active = location === href;

  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-testid={`link-nav-${id}`}
      title={collapsed ? label : undefined}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[12px] font-semibold transition-all duration-200 ${
        active
          ? "bg-[hsl(164_62%_62%/.1)] text-[hsl(var(--foreground))]"
          : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(219_22%_15%)] hover:text-[hsl(var(--foreground))]"
      } ${collapsed ? "justify-center px-2" : ""}`}
    >
      {active && (
        <span className="absolute left-0 h-5 w-0.5 rounded-r bg-[hsl(var(--primary))]" />
      )}

      <Icon
        size={16}
        strokeWidth={active ? 2.2 : 1.7}
        className={
          active
            ? "text-[hsl(var(--primary))]"
            : "transition-colors group-hover:text-[hsl(var(--primary))]"
        }
      />

      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  const vehicle = useVehicle();
  const user = useSession();
  const syncError = useSyncError();

  const current = [
    ...primaryNavigation,
    ...toolsNavigation,
    { href: "/profile", label: "Обліковий запис" },
  ].find((item) => item.href === location);

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="app-noise min-h-[100dvh] bg-[hsl(var(--background))]">
      <div
        className={`fixed inset-0 z-30 bg-[hsl(224_27%_4%/.72)] backdrop-blur-sm transition-opacity md:hidden ${
          mobileOpen
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        onClick={closeMobile}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar)/.96)] px-3 py-5 transition-transform duration-300 md:translate-x-0 ${
          collapsed ? "md:w-[76px]" : ""
        } ${
          mobileOpen
            ? "translate-x-0"
            : "-translate-x-full"
        }`}
      >
        <div
          className={`mb-8 flex items-center ${
            collapsed
              ? "justify-center"
              : "justify-between px-2"
          }`}
        >
          <Link
            href="/dashboard"
            onClick={closeMobile}
            data-testid="link-brand"
            className="flex items-center gap-3"
          >
            <span className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--primary)/.09)]">
              <span className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--primary))] shadow-[0_0_18px_hsl(var(--primary)/.55)]" />
              <span className="absolute h-5 w-5 rounded-full border border-[hsl(var(--primary)/.28)]" />
            </span>

            {!collapsed && (
              <span className="text-[15px] font-extrabold tracking-[-.04em]">
                EV
                <span className="text-[hsl(var(--primary))]">
                  Predict
                </span>
              </span>
            )}
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Закрити меню"
            data-testid="button-close-navigation"
            className="action-ghost p-1.5 md:hidden"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mb-2 px-3 font-mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground)/.65)]">
          {!collapsed && "Система"}
        </div>

        <nav className="space-y-0.5">
          {primaryNavigation.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              collapsed={collapsed}
              onNavigate={closeMobile}
            />
          ))}
        </nav>

        <div className="mb-2 mt-7 px-3 font-mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground)/.65)]">
          {!collapsed && "Дослідження"}
        </div>

        <nav className="space-y-0.5">
          {toolsNavigation.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              collapsed={collapsed}
              onNavigate={closeMobile}
            />
          ))}
        </nav>

        <div className="mt-auto space-y-1 border-t border-[hsl(var(--sidebar-border))] pt-3">
          <NavItem
            href="/profile"
            label="Обліковий запис"
            id="profile"
            icon={UserRound}
            collapsed={collapsed}
            onNavigate={closeMobile}
          />

          <button
            type="button"
            onClick={() =>
              setCollapsed((value) => !value)
            }
            data-testid="button-collapse-navigation"
            className="action-ghost mt-2 hidden w-full md:flex"
          >
            {collapsed ? (
              <ChevronRight size={15} />
            ) : (
              <>
                <ChevronLeft size={15} />
                <span>Згорнути меню</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <div
        className={`min-h-[100dvh] transition-[padding] duration-300 md:pl-[248px] ${
          collapsed ? "md:pl-[76px]" : ""
        }`}
      >
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.82)] px-5 backdrop-blur-xl md:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Відкрити меню"
              data-testid="button-open-navigation"
              className="action-ghost p-2 md:hidden"
            >
              <Menu size={18} />
            </button>

            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold text-[hsl(var(--foreground))]">
                {current?.label ?? "EVPredict"}
              </div>

              <div className="hidden text-[10px] text-[hsl(var(--muted-foreground))] sm:block">
                Прогноз енергоспоживання і планування маршрутів
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))] sm:flex">
              <span className={`status-dot ${vehicle ? "" : "muted"}`} />
              <span data-testid="text-header-vehicle">{vehicle ? vehicle.label : "Автомобіль не обрано"}</span>
            </div>

            <Link
              href="/profile"
              data-testid="link-header-profile"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] text-[11px] font-bold text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary)/.5)] hover:text-[hsl(var(--primary))]"
            >
              {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-5 py-7 md:px-9 md:py-10">
          {syncError && (
            <div data-testid="text-sync-error" className="mb-5 flex items-start gap-2 rounded-lg border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.08)] p-3 text-[11px] text-[hsl(var(--destructive))]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />{syncError}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}