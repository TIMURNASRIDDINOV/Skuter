# Scoot

Scooter-sharing demo for Tashkent — a native rider app, a back-office panel, and
a simulated fleet convincing enough to pitch on.

There is no scooter hardware and no real payments. The fleet runs behind a
`VehicleGateway` seam with a simulated implementation; a stubbed `IotGateway`
marks where MQTT to real controllers lands in phase 2. Payments go through a
mock `PaymentProvider` that always succeeds.

---

## Prerequisites

| | |
|---|---|
| Node | ≥ 22 (`node -v`) |
| pnpm | ≥ 10 — `corepack enable pnpm` |
| Docker | running, for Postgres 16 + PostGIS |
| Xcode / Android Studio | Checkpoint 4 only, to build the native rider app |

## Start

```bash
corepack enable pnpm && pnpm install && cp .env.example .env
```

Then generate a JWT secret and put it in `.env`:

```bash
openssl rand -hex 32
```

Bring up the database, apply migrations, seed the fleet, and run everything:

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev
```

Once running:

```
API        http://localhost:8787        (health: /health)
Admin      http://localhost:5173        (login: admin@demo.uz / demo1234)
Mobile     scan the QR above with the dev client
DB         postgres://localhost:5432/scoot
Simulator  running, 70 vehicles, tick 3s
```

> **Status.** API, database, seed, fleet simulator, admin panel and the native
> rider app are all live. `pnpm dev` starts the API, the admin panel and the
> Expo dev server. The rider app needs a one-time dev-client build first —
> `pnpm -F @scoot/mobile ios` (or `android`) — see `apps/mobile/CLAUDE.md`.

### Everyday commands

```bash
pnpm db:reset      # wipe the volume, migrate, reseed — the "start over" button
pnpm db:seed       # reseed only (truncates first); deterministic
pnpm db:studio     # Drizzle Studio against the local database
pnpm typecheck     # strict, every workspace
pnpm test          # unit tests
```

`pnpm db:seed` is deterministic — the same 70 vehicles land in the same places
every run, so a rehearsed demo stays rehearsed.

---

## The demo script

The definition of done. Phone in one hand, admin panel on the laptop.

- [ ] **1. Open the app.** Native map fills with clustered scooter pins across
      Tashkent. Tap one → bottom sheet with battery, range and pricing.

- [ ] **2. Scan a QR.** Unlock animation, ride starts. QR values match the
      seeded codes (`SCOOT-0001` … `SCOOT-0070`); there is a dev **simulate
      scan** button since there is no physical sticker.
      *Unlock fails ~8% of the time on purpose — that is the retry UI, not a bug.
      Tap retry.*

- [ ] **3. Check the admin panel.** That vehicle flips to `in_use`, the ride
      appears in the live rides table, and its map pin changes colour — **with no
      page refresh**.

- [ ] **4. Try to end the ride outside a parking zone.** The app blocks it and
      shows the nearest valid parking zone with the walking distance.

- [ ] **5. Move into a parking zone and end the ride.** It succeeds. Receipt
      shows duration, distance and the cost breakdown.

- [ ] **6. Buy a weekly plan.** On the admin panel a subscription row appears
      binding that rider to that vehicle with an expiry date, and the vehicle
      disappears from the public map.

- [ ] **7. Draw a new parking zone** on the admin map and save. Pull to refresh
      on the phone — the new zone renders.

### Triggering states live

For steering the demo in the room. Development only, unauthenticated on
purpose, and they take a **QR code or a UUID** so you never have to read an id
aloud.

```bash
# what the simulator is doing right now
curl localhost:8787/dev/simulate/status

# put a scooter on a ride — it starts moving along a generated street route
curl -X POST localhost:8787/dev/simulate/ride -H 'Content-Type: application/json' \
  -d '{"vehicle":"SCOOT-0005"}'

# drop a battery (below 20% flips it to low_battery on the map)
curl -X POST localhost:8787/dev/simulate/battery -H 'Content-Type: application/json' \
  -d '{"vehicle":"SCOOT-0009","pct":8}'

# take one offline — it stops reporting telemetry entirely
curl -X POST localhost:8787/dev/simulate/offline -H 'Content-Type: application/json' \
  -d '{"vehicle":"SCOOT-0011"}'

# put the fleet back the way it was
curl -X POST localhost:8787/dev/simulate/reset
```

---

## Layout

```
apps/mobile      Expo rider app — a real native iOS/Android app
apps/admin       Refine + Ant Design back office
apps/api         Hono API + fleet simulator
packages/shared  zod schemas, shared types, constants
```

Each workspace has its own `CLAUDE.md`. Start at [CLAUDE.md](CLAUDE.md).

## Notes

**Maps.** Expo Go cannot render Google Maps on SDK 54+ — it was removed from
Expo Go on Android in SDK 53, and on iOS Expo Go only supports Apple Maps.
Config plugins, where the Maps API key lives, don't apply to Expo Go because it
is a prebuilt binary. The rider app therefore ships as an **`expo-dev-client`
development build**: same QR-scan-and-reload loop, our own binary. iOS uses
Apple Maps and needs no key. Android needs a Google Maps SDK key in
`EXPO_PUBLIC_ANDROID_GOOGLE_MAPS_API_KEY` — without one, Android map tiles render
grey while everything else still works.

**Postgres image.** `imresamu/postgis` rather than `postgis/postgis`: the
official image is amd64-only and will not run on Apple Silicon. Same contents,
multi-arch build from a docker-postgis maintainer.

**Supabase.** Every query goes through Drizzle and a repository layer, so
migrating is a `DATABASE_URL` change and nothing else.
