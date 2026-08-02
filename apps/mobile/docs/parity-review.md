# Rider app ↔ back office parity

Audit of `apps/mobile` against the decisions recorded in
[`apps/admin/docs/reference-review.md`](../../admin/docs/reference-review.md),
plus the rules and motion plan that follow from it. Written 2026-08-02, before
any code changed.

---

## 0. Headline

**The rider app is not a half-built sibling of the admin panel — it is
substantially finished.** All seven demo beats have working screens, zones
already come from the API rather than a hardcoded rectangle, the cost ticker
already uses `calculateRideCost`, and `lib/theme.ts` already mirrors admin's
status colours by hand.

So this is a consistency pass, not a build-out. Three real gaps, one of them
the exact two-device inconsistency the brief is worried about:

| # | Gap | Severity |
|---|---|---|
| 1 | **Out-of-zone scooters appear on the rider map as normal, rentable pins** while the admin panel flags them red | The one that shows up in the walkthrough |
| 2 | `lib/geo.ts` **duplicates** `isPointInPolygon` from `packages/shared`, with a weaker implementation | Silent divergence risk |
| 3 | **Reduced motion is not respected anywhere** in the app, though admin honours it throughout | Accessibility regression vs admin |

Everything else the brief asks for is either already done or already enforced
somewhere better than the client.

---

## 1. Audit

### 1.1 Screens against the demo script

| Demo step | Screen | State |
|---|---|---|
| 1. Map, clustered pins, tap → sheet | `(tabs)/index.tsx`, `VehicleMarkers`, `VehicleSheet` | **Built.** Supercluster, MapLibre, docked bottom sheet, nearby list |
| 2. Scan QR → unlock, 8% retry | `scan.tsx`, `unlock.tsx` | **Built.** Camera scanner, `__DEV__` simulate-scan, pulsing ring, shake + retry on `unlock_failed` |
| 3. Admin reflects it | — | API-side; nothing owed by mobile |
| 4. End outside parking → blocked | `ride.tsx` | **Built.** 409 `details.check` rendered with nearest zone + walking distance; advisory in-zone pill client-side |
| 5. Park and end → receipt | `ride.tsx`, `receipt.tsx` | **Built.** `__DEV__` step-into-zone control, cost breakdown |
| 6. Buy a weekly plan | `plans.tsx` | **Built.** Plan bound to one vehicle; API removes it from the public map |
| 7. New zone → pull to refresh | `(tabs)/index.tsx` | **Built.** Refresh refetches zones as well as vehicles |

Also present and outside the script: `login` / `verify` (phone OTP),
`profile` (balance, RU/UZ toggle, subscriptions, history), `rental`.

**Nothing is stubbed.** The `__DEV__` controls (simulate scan, step into zone)
are deliberate demo affordances documented in `apps/mobile/CLAUDE.md`, not
placeholders.

### 1.2 What the rider app can reuse from the admin work

| Thing | Where it lives | Reusable? |
|---|---|---|
| `isPointInPolygon` | `packages/shared/src/geo.ts` | **Yes, as-is.** Pure geometry, no UI. Mobile currently ignores it — see §1.3 |
| `haversineDistanceM` | `packages/shared` | Yes, already used for the nearby list |
| Zone / vehicle / ride schemas | `packages/shared` | Yes, already used throughout |
| Severity axis (`Severity`, `VEHICLE_STATUS_SEVERITY`, `SEVERITY_RANK`) | `apps/admin/src/components/status.tsx` | **No — needs moving.** The file imports `antd`, so mobile cannot touch it. See §2.3 |
| `SEVERITY_META` (labels + hex colours) | same file | **No, and should not be.** Labels are Russian-only; mobile is RU/UZ via `i18n.tsx`. Colours are AntD-flavoured. Presentation stays per-app |
| Anomaly derivation (`lib/anomalies.ts`) | `apps/admin` | **No, and not needed.** It classifies six anomaly kinds for an ops queue. The rider needs exactly one of them (out of service zone), which is `isPointInPolygon` plus the zone list |
| `MapAutoSize` | `apps/admin/src/components/MapAutoSize.tsx` | **No.** Leaflet-specific. MapLibre native has its own quirks — see §3.4 |

### 1.3 Gaps in detail

**Gap 1 — out-of-zone scooters are rentable.**

`GET /vehicles` → `repositories.vehicles.listPublic` already filters hard,
server-side:

- status must be in `PUBLIC_VEHICLE_STATUSES` = `['available', 'low_battery']`
- vehicles under an active subscription are excluded

So `offline`, `maintenance`, `in_use` and `reserved` **never reach the rider
app at all** — enforced in the best possible place, better than any client rule
the brief proposes. The brief's worry about `offline` scooters showing as
available is already handled.

What is *not* handled: the three deliberately stranded scooters
(`SCOOT-0068/0069/0070`) are `available`, so `listPublic` returns them and the
rider map draws them as ordinary green pins. The admin panel calls them
`за пределами зоны обслуживания` at **alarm** severity. Same fleet, two
answers — precisely the inconsistency a sharp client notices with both screens
side by side.

**Gap 2 — duplicated point-in-polygon.** `apps/mobile/src/lib/geo.ts` defines
its own `pointInPolygon`, used by `ride.tsx` for the advisory parking pill. It
ray-casts the outer ring only and **ignores interior rings**, where the shared
`isPointInPolygon` subtracts holes. Two implementations of one domain predicate
is exactly what `packages/shared` exists to prevent, and the weaker one is the
one deciding what the rider sees.

**Gap 3 — no reduced-motion support.** Reanimated 4.3.1 is installed and used
in five files (unlock ring, verify shake, receipt/plans entrances, skeleton
pulse). `useReducedMotion` appears nowhere. Admin honours
`prefers-reduced-motion` in every animation it added.

---

## 2. Rules, written before implementing

### 2.1 Fleet visibility rule

Mapped directly onto the admin severity axis, so the two apps cannot disagree
about what is wrong with a scooter.

| Admin severity | Rider app behaviour |
|---|---|
| **alarm** — offline, maintenance, **outside every service zone** | **Not shown.** Not on the map, not in the nearby list |
| **watch** — low battery | **Shown, visually distinct.** Amber pin, battery prominent, still rentable |
| **ok** — available | Normal pin |

Concretely, of the alarm cases only *outside service zone* needs client work;
the rest are already excluded by `listPublic`.

**Honest limitation, flagged rather than papered over.** Hiding a pin is
cosmetic. The API will still start a ride if that scooter's QR is scanned
directly, because `POST /rides` does not check service-area containment. This
is the same relationship the existing parking pill has with the API: the client
is advisory, PostGIS is the authority. Closing it properly means an API-side
check, which is outside a mobile session — recorded in §4 rather than faked
with a client-side block the server would not honour.

**Demo consequence, worth a decision:** applying this rule removes the three
stranded scooters from the rider map. That is correct and consistent, but it
also means the walkthrough cannot point the phone at a stranded scooter to show
the geofence mattering. The geofence still demonstrates itself at step 4
(ending a ride outside a parking zone), which is the scripted beat.

### 2.2 Zone awareness

Already correct: `useZones()` fetches `/catalog/zones`, the same rows the admin
zone editor writes, and `(tabs)/index.tsx` refetches them on pull-to-refresh —
which is what makes demo step 7 work. No hardcoded rectangle anywhere.

The only change is Gap 2: delete `lib/geo.ts::pointInPolygon` and use
`isPointInPolygon` from `@scoot/shared`. `polygonCentroid` stays — it is a
mobile-only helper for the `__DEV__` step-into-zone control and has no admin
counterpart.

### 2.3 Status language, and the one shared-package change

The severity **axis** is domain classification and belongs in
`packages/shared`. The severity **rendering** — labels, hex colours — is
presentation and stays per app: admin renders AntD tags in Russian, mobile
renders RN `View`/`Text` in RU/UZ.

Planned change, backward compatible:

- **Add** to `packages/shared`: `Severity`, `VEHICLE_STATUS_SEVERITY`,
  `SEVERITY_RANK`. Pure data, no UI imports.
- **Edit** `apps/admin/src/components/status.tsx` to re-export those three
  from shared instead of defining them. Every existing admin import keeps
  working unchanged — same names, same file, same values.
- `SEVERITY_META` (Russian labels + colours) **stays in admin** untouched.

This is the guardrail's "shared-package change genuinely required" case: without
it the rider app would have to hand-copy the severity mapping, which is the
duplication the brief is asking to eliminate.

### 2.4 Not faked

Same discipline as admin §2.4. Absent and staying absent:

- **Service-area containment as a server-side rental block** — see §2.1. The
  client hides the pin; it does not pretend to enforce.
- **Idle time / last-ride-ended** — still not exposed by the API (admin §3.2).
- **Vehicle tags, controller status, swappable batteries** — still unmodelled.

---

## 3. Motion plan

### 3.1 What already exists

| Moment | Current |
|---|---|
| Unlocking | Pulsing ring, `withRepeat` 900ms |
| Unlock failure | Spring shake |
| Wrong OTP | 4-step shake, 60ms per leg |
| Receipt / plans entrance | `FadeInDown`, `ZoomIn` |
| Skeletons | Opacity pulse 600ms |

Reasonable, and already Reanimated rather than `LayoutAnimation`.

### 3.2 What to change, and why

| Moment | Change | Reason |
|---|---|---|
| **All of the above** | Route durations through a `useMotion()` hook wrapping Reanimated's `useReducedMotion`; collapse to 0 when reduced | Gap 3. Parity with admin, which honours the OS setting everywhere |
| **Marker movement** | Interpolate position over 250ms ease-out instead of snapping on each 5s poll | Pins currently teleport. Deliberately *not* interpolated across the full 5s interval — that would smooth telemetry into a lie about where a scooter is |
| **Ride cost / timer** | Count up, 250ms ease-out, same as admin's `AnimatedNumber` | Currently a raw re-render each second |
| **Scan → unlock** | A confirmation beat on scan registering, before the "unlocking" state | Brief: no dead air where the rider cannot tell if the scan worked |
| **Find → riding** | Make the sheet transition carry the state change rather than a bare `router.push('/ride')` | Brief: the state change should be unmistakable |
| **Geofence block** | Reads as a block, not form validation: error haptic, sheet slides up with the reason, map animates to the nearest parking zone | Brief. The data (`details.check`) is already there and already rendered — this is about making it land |

Durations 150–250ms, ease-out in / ease-in out, matching admin so the two
apps feel like siblings. Existing 600–900ms loops (skeleton pulse, unlock ring)
stay as they are: those are *ongoing state* indicators, not transitions, and the
150–250ms band does not apply to them.

### 3.3 Native map quirks — assume nothing, verify

Admin's `MapAutoSize` fix does **not** transfer. It exists because Leaflet
measures its container once on mount in JS; MapLibre's view is native and
lays out with the platform, so the invalidate-on-resize problem does not arise
in that form.

MapLibre RN has a different set, which this app already works around in places:

- `cameraRef.current?.easeTo(...)` before the map finishes loading is a no-op —
  the existing code always calls it from user interaction, which is why it
  works today.
- Viewport comes from `onRegionDidChange` rather than being read imperatively;
  `INITIAL_BOUNDS` in `lib/map.ts` seeds clustering before the first callback.

**Not yet verified on a device.** Doing so needs a one-time
`expo prebuild` + native dev-client build, which has not been run in this
session. Every claim in §3.3 is from reading the code, and is marked as such
rather than presented as tested. Findings go here once the build has run.

---

## 4. Deferred, with reasons

| Item | Why deferred |
|---|---|
| Server-side service-area check on `POST /rides` | Closes §2.1 properly. API change, outside a mobile session |
| Verifying map behaviour on a real device | Needs a native dev-client build |
| Admin §3.5 (users, subscriptions, plans, audit) | Separate session; §4.5 of the mobile plan depends on what the admin subscriptions screen ends up expecting |

---

## 5. Change log

*Filled in as each Phase 4 item lands.*

### 5.1 Map screen + visibility rule — pending
### 5.2 Scan → unlock — pending
### 5.3 Active ride — pending
### 5.4 End ride, success and block — pending
### 5.5 Plan purchase — pending
