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
      Tashkent. The sheet rests on a carousel of the nearest scooters — walk
      time, charge, and how long that charge lasts — beside the scan button.
      Tap a card → the pin becomes a bubble, a dashed walking line and its ETA
      appear, and the sheet shows the tariff picker.

- [ ] **1a. Tap a zone badge.** The green **P** explains that a ride may end
      there; an orange speed disc explains that the scooter throttles itself,
      and says to what. «Подробнее о зонах» opens the full legend.

- [ ] **1b. Hold a scooter.** «Забронировать на 10 мин» → a countdown banner
      pins to the map and the pin gains a padlock. Nobody else can see or
      unlock it; on the admin panel it flips to `reserved` with no refresh.
      The hold releases itself when it lapses, and when the ride starts.

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

- [ ] **7a. Draw a speed-limit zone.** Pick «Ограничение скорости», choose a
      cap, save. On the phone it renders orange with its number on a road-sign
      disc; ride into it and the live speed cap appears beside the parking
      pill. Overlapping zones apply the lowest cap.

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

**Maps.** The rider app uses **MapLibre** (`@maplibre/maplibre-react-native`)
with OpenFreeMap's Liberty vector tiles on both platforms — free, no API key,
no registration. MapLibre is a native module and config plugins don't apply to
Expo Go (a prebuilt binary), so the app ships as an **`expo-dev-client`
development build**: same QR-scan-and-reload loop, our own binary.

**Public API URL.** Test builds call
`https://scoot-api.timurnasriddinov56.workers.dev` — a tiny Cloudflare Worker
([infra/cloudflare-proxy](infra/cloudflare-proxy/worker.js)) that forwards to a
Cloudflare quick tunnel into the dev machine. Bring it up with
`scripts/demo-tunnel.sh` (API and database must be running); re-run it whenever
the tunnel drops — the Worker URL is permanent, so installed builds keep
working without a rebuild. One caveat: quick tunnels buffer streaming responses
in 128 KiB chunks, so the admin panel's SSE live updates lag by ~30–60 s when
served through the public URL (the rider app polls REST and is unaffected).
For the fully live admin experience, run it locally against the local API.

**Postgres image.** `imresamu/postgis` rather than `postgis/postgis`: the
official image is amd64-only and will not run on Apple Silicon. Same contents,
multi-arch build from a docker-postgis maintainer.

**Supabase.** Every query goes through Drizzle and a repository layer, so
migrating is a `DATABASE_URL` change and nothing else.
