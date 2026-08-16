# apps/mobile — Expo rider app

A real native iOS/Android app: native maps, native camera QR scanner, native
gestures and bottom sheets. Not React Native Web, not a browser mock.

**Expo SDK 56** — the SDK moves fast; check the versioned docs at
https://docs.expo.dev/versions/v56.0.0/ before reaching for an API from memory.

## Ships as a dev client, not Expo Go

Maps are **MapLibre** (`@maplibre/maplibre-react-native` v11) with OpenFreeMap
Liberty tiles on both platforms — free, keyless; style URL and zoom constants
live in `lib/map.ts`. MapLibre is a native module and config plugins don't
apply to Expo Go (see README "Maps"). The app is an **`expo-dev-client`
development build**:

```bash
pnpm -F @scoot/mobile exec expo prebuild --platform ios   # generates ios/ (gitignored)
pnpm -F @scoot/mobile ios                                 # build + run on simulator/device
pnpm -F @scoot/mobile dev                                 # dev server only, once a client is installed
```

`EXPO_PUBLIC_API_URL` must be reachable **from the phone** — the machine's LAN
IP on a real device; `localhost` works on the iOS Simulator. Expo CLI loads
`apps/mobile/.env` first, then `app.config.ts` fills the rest from the root
`.env`.

## Layout

```
src/
  app/               expo-router file routes
    _layout.tsx      providers + Stack.Protected auth gate
    login.tsx        phone entry → OTP request
    verify.tsx       6-digit code, dev-code prefill, resend cooldown
    (app)/           signed-in stack — no tab bar, the map is the only root
      index.tsx      map home: pins, zones, the ☰/scan/locate row, the sheet
      profile.tsx    settings: phone, name, RU/UZ toggle, sign out
      rent.tsx       Аренда — active passes and the daily/weekly plans
      history.tsx    every ride taken, tapping through to its receipt
      rules.tsx      zone legend — what each colour on the map means
      scan.tsx       camera QR scanner + dev "simulate scan" button
      unlock.tsx     optimistic unlock, 8% failure retry UI
      ride.tsx       live ride: cost ticker, end-ride geofence, receipt handoff
      receipt.tsx    cost breakdown after a ride (also reached from history)
      plans.tsx      buy a daily/weekly subscription bound to one vehicle
  api/
    client.ts        apiFetch + ApiRequestError + SecureStore token (mirrors admin's lib/api.ts)
    session.tsx      SessionProvider; 401 anywhere signs out via one handler
    queries.ts       every TanStack Query hook and mutation, with invalidations
  components/        ui primitives, states (skeletons/empty/error), map layers, sheet content
  lib/               theme (status colours mirror admin), i18n (RU/UZ), format, geo helpers
```

## Rules that matter here

**Riders have no SSE stream** — `/admin/events` requires an admin token. Live
state is polling: vehicles every 5 s, the active ride every tick (3 s). Do not
try to open an EventSource here.

**The cost ticker uses `calculateRideCost` from `@scoot/shared`** — the same
pure function the API charges with, so the number the rider watches is the
number on the receipt. Never approximate it locally.

**The rider's ride position is the vehicle's live position** (the rider is
standing on the scooter; the simulator moves it). Demo steps 4–5 need a way to
"walk into a parking zone", so the ride screen has a dev-only **step into
zone** control, exactly like the dev **simulate scan** button on the scan
screen. Both are `__DEV__`-gated.

**End-ride rejections are UI, not errors.** A 409 with
`outside_parking_zone` / `inside_forbidden_zone` / `outside_service_area`
carries `details.check` (a `ParkingCheck`) with the nearest legal zone and the
walking distance — render it (demo step 4). The client-side point-in-polygon
pill is advisory; the API is the authority.

**Retrying a failed unlock is safe.** The API sends the unlock command before
creating the ride row, so `unlock_failed` (409, ~8% by design) commits nothing.
The retry button re-POSTs `/rides` verbatim — that is the demo's retry UI, not
a bug.

**Status and zone colours come from `lib/theme.ts` only**, and they mirror
`apps/admin/src/components/status.tsx` (and `apps/miniapp/src/lib.ts`). A colour
never means two things across the apps. The `chrome` tokens are for controls
over a **dark** surface — the camera viewfinder — not over the map: the map's
floating row is white circles on `shadows.lg`.

**The look is bold, and it comes from `lib/theme.ts`.** Cream canvas, an ink
outline on every surface, volt green for the one thing you are meant to press,
heavy uppercase micro-labels. Three rules follow from that and are easy to get
wrong:

- **`colors.primary` (volt `#BCF246`) is a fill, never a foreground.** At 15sp
  on white it is unreadable. Text or an icon that wants to look primary on a
  light surface uses `colors.primaryInk`; anything sitting *on* a volt fill uses
  `colors.onPrimary` (ink), not `textInverse`.
- **Selection is a fill and a lift, not a border colour.** Every tile is already
  outlined at rest, so the outline cannot also carry "chosen" — the tariff
  tiles, the plan cards and the OTP cells all switch to a volt fill plus
  `shadows.md` instead.
- **Spread `outline` / `outlineHair`, not a hand-written border pair**, and take
  elevation from `shadows` — those are hard offset shadows, so the pressed state
  is `PRESS_SINK` (translate down, drop the offset), never an opacity fade.

**The map screen is the app's only root.** No tab bar and no section switcher,
and the sheet is closed at rest. The map carries one chrome row at the top —
the SCOOT/TAS brand pill, the balance, and the zones toggle — the banners under
it, and one floating row at the bottom: ☰, the scan circle, locate. Everything
else (`/profile`, `/rent`, `/history`, `/rules`) is pushed from the ☰ sheet, and
`navigateFromMenu` closes the sheet *before* pushing, so a route never opens
behind it.

**Zones are drawn by default and the toggle only hides them.** `showZones` in
`index.tsx` gates both `ZoneOverlays` and `ZoneMarkers`. A rider who does not
know the rules is the one who needs the polygons; the switch exists for the
other case — four overlapping shapes over the pin you are trying to tap.

**Estimates are derived, never invented.** Walk time and remaining ride time
come from `walkMinutes` / `rideMinutesLeft` in `lib/fleet.ts`, built on the
server's own `rangeM` and a straight-line distance. There is no routing service
and we are not adding a keyed one — which is why the walk line is **dashed**:
it claims a direction and a rough distance, not a route.

**The sheet has five modes and a closed state** — menu / nearby / vehicle / zone
/ tariff, or `null` — held in `SheetMode` in `index.tsx`. Adding a sixth means
adding a variant there, not another piece of boolean state. Closed is `null`
plus `sheetRef.close()`; both, or the sheet and the mode drift apart.

**Reservation holds are polled, like everything else.** `useReservation` runs on
the 5 s fleet cadence; `ReservationBanner` ticks its countdown locally each
second off the server's timestamp, so it cannot drift. A hold that lapses fires
`onExpire`, which refetches rather than waiting for the next poll.

**Anything derived from `reservedUntil` must test `typeof … === 'string'`,
not `!== null`.** A payload from a backend that predates the reservation
columns leaves the field `undefined`, and `undefined !== null` put a padlock on
every scooter on the map.

**Icons come from the `Icon` vocabulary in `components/ui.tsx`** (native SF
Symbols on iOS, Material Symbols on Android via expo-symbols). No emoji as UI
chrome; shadows come from the `shadows` tokens in `lib/theme.ts`, never
hand-rolled.

**Strings go through `lib/i18n.tsx`** (RU default, UZ toggle in Profile).
No hardcoded user-facing text in screens.

**Money**: `formatSom` from shared, nothing hand-rolled. **Time**: stored UTC,
displayed `Asia/Tashkent` via `lib/format.ts`.

## Commands

```bash
pnpm -F @scoot/mobile typecheck   # tsc strict; route types need `expo start` once
pnpm -F @scoot/mobile dev         # Metro dev server (QR for the dev client)
```
