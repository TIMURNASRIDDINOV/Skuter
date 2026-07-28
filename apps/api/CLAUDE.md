# apps/api — Hono API + fleet simulator

Node + Hono + Drizzle + PostGIS. Owns the domain, the fleet simulator and the
event stream the admin panel consumes.

## Layout

```
src/
  env.ts            zod-validated env; process refuses to start on bad config
  app.ts            Hono app + route mounting
  index.ts          server bootstrap, startup banner, graceful shutdown
  db/
    schema.ts       Drizzle tables — see "geometry" below
    types.ts        PostGIS custom column types
    sql.ts          geometry select helpers
    client.ts       pg Pool + Drizzle handle
    migrate.ts      CREATE EXTENSION postgis, then apply migrations
    migrations/     drizzle-kit output — generated, do not hand-edit
  gateway/          THE ONLY code that knows which gateway is live
    types.ts        VehicleGateway, SimulationControl, in-memory fleet state
    simulated.ts    SimulatedGateway — fleet state + tick loop
    iot.ts          IotGateway — phase-2 stub, throws NotImplementedError
    index.ts        factory + lifecycle
  simulator/
    paths.ts        street-like route generation
  repositories/     THE ONLY code that touches Drizzle
  routes/           HTTP surface, one file per area
  middleware/       auth + the single error boundary
  lib/              errors, jwt, password, logger
  seed/             deterministic demo dataset
```

## Rules that matter here

**Nothing outside `repositories/` may import `db/schema.ts` or write SQL.**
Routes and the simulator receive repositories. This is what makes the promise
"point `DATABASE_URL` at Supabase and nothing else changes" actually true.

**Every endpoint is zod-validated in and typed out.** Request schemas come from
`@scoot/shared` via `@hono/zod-validator`; responses are annotated `satisfies`
the shared type. Never define a type here that already exists in shared.

**Errors go through `ApiHttpError`.** `middleware/error.ts` is the only place
that builds an error body. Anything not an `ApiHttpError` becomes an opaque 500
so internals never leak.

**No `console.log`.** Use `lib/logger.ts` (`logInfo` / `logWarn` / `logError` /
`write`). Hono's request logger is wired to it.

## Geometry — read this before touching a geo column

Drizzle's native `geometry()` helper is **not** used, for two reasons:
- Polygon and LineString are not predefined by Drizzle at all.
- For `point`, drizzle-kit **drops the `srid` option** from the emitted DDL — it
  generates `geometry(point)`, i.e. SRID 0. Mixed with the SRID 4326 zone
  polygons, `ST_Contains` / `ST_DWithin` fail with *"Operation on mixed SRID
  geometries"*.

So all three live in `db/types.ts` as custom types pinned to SRID 4326:
`point4326`, `polygon4326`, `lineString4326`.

**Writes** serialise to `ST_SetSRID(ST_GeomFromGeoJSON(...), 4326)` automatically.

**Reads must go through `db/sql.ts`** (`selectPoint` / `selectPolygon` /
`selectLineString`), which emit `ST_AsGeoJSON(col)::json`. Postgres returns
geometry as WKB hex otherwise; `fromDriver` throws a pointed error if a query
forgets, rather than handing back a hex blob.

Use `::geography` for anything measured in metres (`ST_DWithin`, `ST_Distance`).
On plain `geometry` those take degrees, which is silently wrong.

## Money and time

Money is integer **tiyin** in `bigint({ mode: 'number' })`. `integer` would cap
at ~21.5M so'm, too tight for a wallet balance. node-postgres is configured in
`db/client.ts` to parse INT8 to `number` — every such column is well inside
`Number.MAX_SAFE_INTEGER`.

Ride cost is **never** computed here. `calculateRideCost` in `@scoot/shared` is
the single implementation, shared with the rider app so a receipt can't disagree
with what the phone displayed.

Timestamps are `timestamptz`, always stored UTC. `Asia/Tashkent` is a display
concern only.

## Deviations from the specced data model

Three additions, all load-bearing:

- **`otp_codes` table** — phone-OTP auth needs somewhere to keep a hashed code
  with an expiry and an attempt counter.
- **`rides.plan_id`** — without it a ride's cost can't be recomputed or
  explained, and editing a plan's price would retroactively rewrite historical
  receipts.
- **minor columns** — `plans.active`, `commands.failure_reason`,
  `commands.created_at`, `payments.created_at`, `admins.created_at`.

## Auth

Riders: phone OTP (`POST /auth/otp/request` → `/auth/otp/verify`). In
development `DEV_OTP_CODE` (default `000000`) is accepted even with no pending
row, so a mid-demo restart can't lock the phone out. Sending a real SMS is a
marked stub — it is outside the demo path.

Admins: email + password, bcrypt. `bcryptjs` over argon2 deliberately — pure JS,
no native binary to fail installing on a demo machine. For production, argon2id
via `@node-rs/argon2`.

JWT via Hono's built-in `hono/jwt`, HS256 pinned explicitly on both sign and
verify. `role` claim (`rider` | `admin`) selects the middleware that accepts it.

## Commands

```bash
pnpm -F @scoot/api dev          # watch mode
pnpm -F @scoot/api db:generate  # regenerate migrations after a schema change
pnpm -F @scoot/api db:migrate   # apply
pnpm -F @scoot/api db:seed      # deterministic reseed (truncates first)
pnpm -F @scoot/api typecheck
```

`db:seed` is deterministic — same 70 vehicles in the same places every run, so a
rehearsed demo stays rehearsed. It truncates before seeding.

## The vehicle gateway

`src/gateway/` is the seam between this application and scooter hardware.
**`gateway/index.ts` is the only module that knows which implementation is
live** — everything else calls `getVehicleGateway()` and programs against the
`VehicleGateway` interface. Selected by `VEHICLE_GATEWAY` (`simulated` | `iot`).

`SimulatedGateway` holds fleet state in memory, advances it every
`SIMULATOR_TICK_MS`, and flushes positions and batteries to Postgres in **one
batched UPDATE per tick** — 70 vehicles every 3s as 70 round-trips would
dominate the tick. Ticks never overlap: a slow tick is skipped, not queued.

`IotGateway` throws `NotImplementedError` everywhere and documents the phase-2
MQTT design in its class comment.

Demo controls are a separate interface, `SimulationControl`, obtained via
`getSimulationControl()`. It returns **null** for real hardware — you cannot
"force a ride" on a scooter someone is holding — and the routes answer 501
rather than pretending.

### Simulation tuning

Battery drain is **demo-compressed** (`IDLE_DRAIN_PCT_PER_TICK`,
`RIDING_DRAIN_PCT_PER_TICK` in `simulated.ts`) so a viewer sees battery move
within ~30 seconds. A real scooter drains orders of magnitude slower. Idle
vehicles random-walk within 8 m of an anchor — parked scooters jitter on GPS,
they do not wander. Offline and maintenance vehicles report no telemetry at all,
which is what makes them look genuinely offline on the map.

Routes come from `simulator/paths.ts`: an axis-aligned staircase with jittered
leg lengths, densified to ~20 m so the polyline animates smoothly. A straight
line reads as obviously fake. Guarded by `paths.test.ts`, which asserts every
route turns at least twice and that the mean detour ratio matches Manhattan
routing (~1.27). Note a trip due N/S/E/W is legitimately straight under grid
routing — assert on turns, not on detour ratio alone.

## Dev endpoints

`/dev/simulate/*`, gated on `NODE_ENV !== production`. Deliberately
unauthenticated so they can be fired from a terminal mid-demo. They accept a
vehicle **UUID or QR code**, because nobody wants to read a UUID aloud in a
client meeting.

```bash
curl localhost:8787/dev/simulate/status
curl -X POST localhost:8787/dev/simulate/reset
curl -X POST localhost:8787/dev/simulate/ride    -H 'Content-Type: application/json' -d '{"vehicle":"SCOOT-0005"}'
curl -X POST localhost:8787/dev/simulate/battery -H 'Content-Type: application/json' -d '{"vehicle":"SCOOT-0009","pct":8}'
curl -X POST localhost:8787/dev/simulate/offline -H 'Content-Type: application/json' -d '{"vehicle":"SCOOT-0011"}'
```

## Not built yet

Checkpoint 3 adds ride/subscription/zone-write endpoints, the PostGIS geofence
checks (`ST_Contains`, `ST_DWithin`) and the SSE stream at `/admin/events`.
`unlock`/`lock`/`beep` currently have no HTTP route — they are exercised by the
ride lifecycle, which lands in Checkpoint 3.
