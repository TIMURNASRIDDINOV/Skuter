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
  sms/              THE ONLY code that knows which SMS provider is live
  routes/           HTTP surface, one file per area
  middleware/       auth + the single error boundary
  lib/              errors, jwt, password, logger, telegram + google token checks
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

Four additions, all load-bearing:

- **`otp_codes` table** — phone-OTP auth needs somewhere to keep a hashed code
  with an expiry and an attempt counter. It doubles as the rate-limit ledger:
  `request_ip` plus `created_at` is what the per-number and per-IP caps count.
- **`users.google_sub` / `users.email`** — Google sign-in. `google_sub` is the
  only match key; `email` is display only.
- **`rides.plan_id`** — without it a ride's cost can't be recomputed or
  explained, and editing a plan's price would retroactively rewrite historical
  receipts.
- **minor columns** — `plans.active`, `commands.failure_reason`,
  `commands.created_at`, `payments.created_at`, `admins.created_at`.

## Auth

Riders sign in three ways, all landing on `riderSession()` in `routes/auth.ts`:
**phone OTP**, **Google**, and **Telegram**.

**Phone OTP** (`POST /auth/otp/request` → `/auth/otp/verify`). Any +998 number
can register; the code is random and goes out over the SMS gateway.
`services/otp.ts` is the single implementation, shared with `/me/phone/*` so a
linked number is verified exactly as strictly as one used to sign in.

`DEV_OTP_CODE` is accepted **only** for numbers in `OTP_BYPASS_PHONES`, and
only while dev features are on — it exists so a rehearsed demo never waits on a
carrier. Read the direction carefully, because it inverted: `OTP_TEST_PHONES`
used to be an *allowlist* deciding who could sign in at all, when a fixed code
plus no SMS provider meant an open door. `OTP_BYPASS_PHONES` is a *bypass
list* — everyone signs in, these numbers skip the SMS — so **empty now means
nobody, which is the safe default**. `env.ts` throws on startup if the old
variable is still set rather than applying the opposite of the intended policy.
Both stay secrets on a deployed instance: one is a working credential for those
numbers, the other is a list of real personal numbers.

**Rate limits are not optional here.** Every SMS is billed, so
`services/otp.ts` enforces a 60 s resend cooldown, 5 codes per number per day,
and 20 per IP per hour, all counted off `otp_codes` rows. A send that fails
consumes its row before returning 429 — telling a rider a code is coming when
it is not is worse than an error, and leaving the row would strand them behind
the cooldown holding a code they never got.

**Google** (`POST /auth/google`). The app sends the ID token from the native
sheet; `lib/google.ts` verifies it against Google's published keys with
WebCrypto only, pinning RS256 and checking `iss`, `exp`, `email_verified` and —
the check that matters — `aud` against our own client ids. Without that last
one any validly-signed Google token from any project would be accepted.
Accounts match on `sub` alone, never on email: adopting an account because its
address matches would be an account-takeover path.

**Telegram** (`POST /auth/telegram/start` → `/auth/telegram/poll`, driven by
`routes/telegram-webhook.ts`). This is the path that makes Scoot able to verify
a phone number **with no SMS provider at all**, which matters because Eskiz
requires a company contract — see the SMS gateway section.

The bot conversation has two legs, and the second is the point of it:

1. `/start <nonce>` — the webhook claims the nonce, records the chat, and
   replies with a `request_contact` keyboard button.
2. the shared contact — Telegram hands over the number it verified when the
   account was created, and only then does the nonce complete.

Sharing is **required**: tapping Start no longer signs anybody in. Two
consequences that are easy to undo by accident:

- **No account is created on Start.** Identity is resolved on the contact leg,
  by `findOrCreateForTelegramContact`. Creating a rider at Start would leave an
  orphan behind every abandoned attempt, and would dead-end anyone whose number
  is already on a Google account.
- **`contact.user_id` must equal `message.from.id`.** Telegram's attachment
  menu lets anyone forward a *third party's* contact card, arriving in exactly
  the same shape. That single comparison in `parseSharedContact` is the whole
  security of the flow — without it a rider registers somebody else's number.
  Guarded in `telegram.test.ts`.

Matching order on the contact leg is Telegram id, then **phone**, then create.
Falling back to the phone is deliberate and is the opposite of the Google rule
above: an email is merely asserted, whereas a shared contact is proven, so it is
safe to treat as the same person and merge the identities onto one account.

Foreign numbers are rejected distinctly from forwarded cards (`normalisePhone`
returns null for anything that is not `+998`), because "share your own number"
is useless advice to someone whose Telegram is simply on a Russian SIM.

`POST /me/phone/telegram/start` is the same mechanism for a signed-in rider
attaching a number — a `link` nonce carries the account, so the number lands on
*that* rider rather than on whoever the Telegram identity maps to.

**Google and Telegram accounts have no phone at sign-up**, so
`services/rides.ts` requires one before a ride starts (`phone_required`) — a
scooter goes out on the street under somebody's name. That is the only place
the requirement lives; sign-up itself is deliberately not blocked. Telegram
riders satisfy it during login and never see the gate.

Admins: email + password, bcrypt. `bcryptjs` over argon2 deliberately — pure
JS, no native binary to fail installing on a demo machine. For production,
argon2id via `@node-rs/argon2`.

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

## The SMS gateway

`src/sms/` is the seam between this application and an SMS provider, the same
shape as `src/payments/` and the vehicle gateway: **`sms/index.ts` is the only
module that knows which implementation is live.** Selected by `SMS_GATEWAY`
(`console` | `eskiz`), defaulting to `console` unless Eskiz credentials are
present, so `pnpm dev` works out of the box and nobody burns provider credit by
accident.

**Eskiz needs a company.** OTP traffic is sold only to registered legal
entities (ООО / ИП), so an individual cannot get the contract at all. That is
why the Telegram contact flow above exists: it verifies a number without any
provider, and is the working path today. Everything below applies once a
contract does exist.

`EskizSmsGateway` uses `fetch` only, so it runs unchanged on Workers. It is
proven against production — login, token refresh and a real send all work. What
stands between it and real OTP delivery is **account state at eskiz.uz**, and
the gates come in this order:

1. **A signed contract.** Until then the account is `role: "test"`, which can
   send only Eskiz's own fixed strings ("Bu Eskiz dan test" and friends) — and,
   less obviously, **cannot submit message texts for moderation at all**. The
   cabinet answers *«В Вашем статусе доступ к этой функции ограничено»*. So the
   contract is the first gate, not the last one. Contact @eskizhelpbot.
2. **Moderation of the message text**, once submitting is possible. Moderation
   runs every 3 hours, 10:00–16:00 on weekdays. The operators reject
   authorisation codes that do not name the service *and* state what the code
   is for, and the text must be submitted in the exact form it will be sent,
   with a literal example code rather than a placeholder.

Both are why `smsText()` in `services/otp.ts` is a hardcoded string rather than
a template built at call time: each distinct wording is separately approved, so
changing it means going back through moderation. An unapproved text is accepted
by the send endpoint and then dropped by the operator — it fails silently, which
is the trap worth knowing about.

## The vehicle gateway

`src/gateway/` is the seam between this application and scooter hardware.
**`gateway/index.ts` is the only module that knows which implementation is
live** — everything else calls `getVehicleGateway()` and programs against the
`VehicleGateway` interface. Selected by `VEHICLE_GATEWAY` (`simulated` | `iot`).

`SimulatedGateway` holds fleet state in memory, advances it every
`SIMULATOR_TICK_MS`, and flushes to Postgres in **two batched statements per
tick** — one UPDATE for vehicles, one for every ride in flight. Either as
round-trips per row would dominate the tick. Ticks never overlap: a slow tick
is skipped, not queued.

### The tick is metered — read this before adding a query to it

On Cloudflare the tick is a Durable Object alarm that runs all day whether or
not anybody is connected, so its cost is a standing bill rather than a cost per
request. Left unmetered it billed ~116k Hyperdrive queries in a day against 62
HTTP requests. Three rules keep it down, and a change that breaks one of them
will not show up in any test:

- **Nothing per-row.** Both writes are `VALUES`-join batches
  (`updateTelemetryBatch`, `updateProgressBatch`). A repository method that
  writes one row per call has no business inside the fleet loop.
- **Only rows that changed are written.** A vehicle is flushed when it is under
  way, when its status moves, or when its rounded battery steps; everything else
  waits for `IDLE_FLUSH_EVERY_N_TICKS` (~60 s). Parked positions therefore land
  in Postgres up to a minute late — that is jitter inside an 8 m anchor radius,
  and the live map does not read it from Postgres anyway. `flushedStatus` /
  `flushedBatteryPct` on `SimulatedVehicle` track what the database was last
  told; any code path that writes a vehicle directly must update them.
- **The SSE fan-out is separate from the write.** `#tick` builds `frames` (every
  reporting vehicle, published every tick) and `updates` (the filtered subset
  that is written). Publishing from `updates` would freeze idle pins on the
  admin map — this is the one mistake this design invites.

With no ride in flight and no admin on the event stream, the alarm backs off
from 3 s to 30 s. Anything that creates motion or an audience must pull it back
through `FleetSimulator#wake()` — `beginRide`, `forceRide`, `resetFleet` and an
SSE connect already do. **A new way to start a ride that does not call `#wake()`
leaves the scooter still for up to 30 s**, which reads as a broken unlock.

`IotGateway` throws `NotImplementedError` everywhere and documents the phase-2
MQTT design in its class comment.

Demo controls are a separate interface, `SimulationControl`, obtained via
`getSimulationControl()`. It returns **null** for real hardware — you cannot
"force a ride" on a scooter someone is holding — and the routes answer 501
rather than pretending.

### Reservation holds — status writes go through the gateway

`services/reservations.ts` never writes a vehicle's **status** with
`repositories.vehicles.updateStatus`. It calls
`getSimulationControl()?.setStatus()`, falling back to the repository only when
no simulated gateway is live.

This is not stylistic. The simulator holds the fleet in memory and flushes
every vehicle's status to Postgres on each tick, so a status written straight
to the database survives at most one tick (3 s) before the simulator's stale
in-memory copy overwrites it — a hold placed at t=0 silently vanished at t=3s.
The same applies to *releasing* a hold, which is why `releaseExpiredReservations`
releases row by row instead of issuing one bulk `UPDATE`.

The hold columns themselves (`reserved_until`, `reserved_by`) are ordinary
repository writes — only `status` has to cross the gateway seam.

The hold-clearing statements return `batteryPct` and the position alongside
`status` (`ReleasedVehicle`), so the `vehicle.updated` event is built entirely
from the write. Do not reintroduce a `findById` to fill those in: it is a round
trip per released vehicle, and it is the cached-read hazard this module exists
to avoid.

Two more things reservations touch:

- **`#statusForBattery` in `simulated.ts` treats `reserved` as operator-chosen**,
  alongside `maintenance` and `in_use`. Without it a held scooter's idle drain
  can flip it to `low_battery` and drop a rider's hold while they walk to it.
- **Expiry is lazy**, swept at the top of `GET /vehicles` and before a ride
  starts. No scheduler, so it behaves the same on Node and on Workers.

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
