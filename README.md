# EVPredict

Personal EV energy forecasting and charging-aware route planning for Ukraine.

## Features

- Trip energy forecast: physics model + personal factor learned from trip history, Shapley explanation, what-if scenarios
- Intercity routes with charging stops: RCSPP (label-setting + A*), station reliability index, weather and terrain
- Battery, driver profile, charging stations and model accuracy pages
- Auth, PostgreSQL storage, data export and account deletion

## Stack

TypeScript · pnpm workspaces · React 19, Vite, Tailwind · Express 5, Zod · Drizzle ORM, PostgreSQL (PGlite for local dev)

## Run

```bash
pnpm install
pnpm run build
pnpm start            # http://localhost:5000
```

Optional env: `DATABASE_URL` (embedded PGlite if unset), `PORT`, `OPEN_METEO_URL`.

Dev mode:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/evpredict run dev      # :5173, proxies /api
```

## Tests

```bash
pnpm test
pnpm --filter @workspace/energy run test:coverage
pnpm --filter @workspace/api-server run test:coverage
```

## Layout

| Path | |
|---|---|
| `lib/energy` | core: energy model, personalization, explanations, simulators, routing, parameter registry |
| `lib/db` | Drizzle schema and migrations |
| `artifacts/api-server` | Express API |
| `artifacts/evpredict` | React client |
| `research` | experiments and report scripts |

## Data

Open Charge Map (Ukraine snapshot, 2026-10-10) · Copernicus DEM GLO-90 via Open-Meteo · Open-Meteo weather · VED (research only)
