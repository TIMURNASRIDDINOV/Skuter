# Ozo Thunder — Bukhara scooter-sharing demo

A client pitch, not a product. There is no scooter hardware and there are no
real payments: the fleet is simulated behind a swappable gateway, and payments
go through a mock provider. The simulation is the centrepiece, so it has to be
convincing.

**Definition of done is the 7-step demo script in [README.md](README.md).**

## Workspaces

Each has its own `CLAUDE.md` with the rules that apply there. Read that one, not
this file, when working inside a workspace.

| Workspace | What it is |
|---|---|
| [`packages/shared`](packages/shared/CLAUDE.md) | zod schemas, inferred types, domain constants. Single source of truth. |
| [`apps/api`](apps/api/CLAUDE.md) | Hono + Drizzle + PostGIS. Domain, fleet simulator, event stream. |
| [`apps/admin`](apps/admin/CLAUDE.md) | Vite + React + Refine + Ant Design back office. |
| `apps/mobile` | Expo rider app — a real native iOS/Android app. *(Checkpoint 4)* |

## Non-negotiables

**The rider app is native.** Native maps, native camera QR scanner, native
gestures, native bottom sheets, running on a device through Expo. Not a web app,
not React Native Web, not a browser mock of a phone. The admin panel is a normal
web app — that one is meant to be.

**`packages/shared` is the single source of truth.** Never define a type in two
places. Ride cost has exactly one implementation, `calculateRideCost`, used by
both the API and the app.

**TypeScript strict everywhere.** No `any`, no `@ts-ignore`.

**No `TODO` or `console.log` on any path the demo script touches.** Stubs
elsewhere are fine but must be clearly marked as such.

**Real error and empty states.** Loading skeletons, not spinners on white.
Optimistic UI on unlock, with rollback when the simulated 8% failure fires.

**Never commit secrets.** `.env` is gitignored; `.env.example` documents every
variable.

## Money and time

Integer **tiyin** internally (1 so'm = 100 tiyin), displayed as `12 500 so'm`.
All timestamps stored and transported UTC, displayed in `Asia/Samarkand`.

## Build order

Each checkpoint stops for review.

1. ✅ Foundation — monorepo, PostGIS, schema + migrations, shared, auth, seed
2. ✅ Gateway + simulator — `VehicleGateway`, `SimulatedGateway`, tick loop, `/dev/simulate/*`
3. ✅ API — ride/subscription/zone endpoints, PostGIS geofencing, SSE stream
4. Rider app — the native app, all screens, on a device
5. ✅ Admin — all screens, live updates
6. Polish — empty/loading/error states, RU/UZ strings, full demo run-through

## Explicitly not building

Photo-on-park verification, penalty/appeal workflow, referrals, promo codes,
battery-swap stations, operator/technician app, real payment gateway, push
notifications, store submission, CI/CD, Kubernetes, microservices. If one of
these looks necessary, say so and wait — do not build it.
