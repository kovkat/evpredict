import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppShell } from '@/components/app-shell';
import NotFound from '@/pages/not-found';
import { LoginPage, RegisterPage, ProfilePage } from '@/pages/account-pages';
import { DashboardPage } from '@/pages/dashboard-page';
import { VehiclePage } from '@/pages/vehicle-page';
import { PredictionPage } from '@/pages/prediction-page';
import { ChargingPage } from '@/pages/charging-page';
import { boot, useAppState } from '@/lib/storage';

// сторінки з графіками і великими таблицями завантажуються окремими фрагментами
const TripsPage = lazy(() => import('@/pages/trips-page').then((m) => ({ default: m.TripsPage })));
const RoutePlannerPage = lazy(() => import('@/pages/route-page').then((m) => ({ default: m.RoutePlannerPage })));
const BatteryPage = lazy(() => import('@/pages/battery-page').then((m) => ({ default: m.BatteryPage })));
const BehaviorPage = lazy(() => import('@/pages/behavior-page').then((m) => ({ default: m.BehaviorPage })));
const ModelsPage = lazy(() => import('@/pages/models-page').then((m) => ({ default: m.ModelsPage })));

const PUBLIC = ['/login', '/register'];

function Shell({ children }: { children: ReactNode }) {
  return <AppShell><Suspense fallback={null}>{children}</Suspense></AppShell>;
}

function Splash({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="app-noise flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[hsl(var(--background))] p-6 text-center">
      <span className="text-[17px] font-extrabold tracking-[-.04em]">EV<span className="text-[hsl(var(--primary))]">Predict</span></span>
      <span className="max-w-sm text-[12px] text-dim" data-testid="text-splash">{text}</span>
      {action}
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  const status = useAppState((s) => s.status);
  const bootError = useAppState((s) => s.bootError);

  if (status === 'loading') return <Splash text="Завантаження…" />;
  if (status === 'offline') {
    return <Splash text={bootError} action={<button type="button" className="action-primary" onClick={() => void boot()}>Спробувати ще раз</button>} />;
  }
  const isPublic = PUBLIC.includes(location);
  if (status === 'anon' && !isPublic) return <Redirect to="/login" replace />;
  if (status === 'ready' && isPublic) return <Redirect to="/dashboard" replace />;

  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/"><Redirect to="/dashboard" replace /></Route>
        <Route path="/dashboard"><Shell><DashboardPage /></Shell></Route>
        <Route path="/vehicle"><Shell><VehiclePage /></Shell></Route>
        <Route path="/battery"><Shell><BatteryPage /></Shell></Route>
        <Route path="/prediction"><Shell><PredictionPage /></Shell></Route>
        <Route path="/trips"><Shell><TripsPage /></Shell></Route>
        <Route path="/behavior"><Shell><BehaviorPage /></Shell></Route>
        <Route path="/routes"><Shell><RoutePlannerPage /></Shell></Route>
        <Route path="/charging"><Shell><ChargingPage /></Shell></Route>
        <Route path="/models"><Shell><ModelsPage /></Shell></Route>
        <Route path="/profile"><Shell><ProfilePage /></Shell></Route>
        <Route path="/settings"><Redirect to="/profile" replace /></Route>
        <Route><Shell><NotFound /></Shell></Route>
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  useEffect(() => { void boot(); }, []);
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Router />
    </WouterRouter>
  );
}

export default App;
