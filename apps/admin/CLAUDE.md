# apps/admin — Refine back office

Vite + React 19 + Refine v5 + Ant Design 5. A dense internal tool, not a
landing page: tight tables, small controls, no hero sections.

## Layout

```
src/
  App.tsx            Refine + router + theme
  components/
    Shell.tsx        sider, header, live-connection indicator
    FleetMap.tsx     Leaflet fleet map + legend
    status.tsx       ONE definition of every status colour and label
    states.tsx       loading skeletons, empty and error states
  pages/             one file per screen
  providers/         Refine data + auth providers
  lib/
    api.ts           fetch wrapper, token storage
    events.ts        the shared SSE connection
    useLiveFleet.ts  fleet state kept current from SSE
    format.ts        dates in Asia/Samarkand, durations, distances
    money.ts         tiyin -> so'm
```

## Version constraints — do not bump blindly

- **antd must stay on 5.x.** `@refinedev/antd@6` peers on `antd: ^5.23`.
  antd 6 is released and will break Refine.
- **react-router must stay on 7.x.** `@refinedev/react-router@2` peers on
  `react-router: ^7`. react-router 8 is released and is not compatible.
- react-leaflet 5 requires React 19 — already the case here.

## Live updates

One `EventSource` for the whole panel, opened in `lib/events.ts` and shared
through a module-level subscriber set. Opening a stream per component would
multiply a fleet already emitting ~20 events a second.

The stream is **reference-counted** and closes when the last subscriber
unmounts. `Shell` therefore holds a no-op subscription for as long as the panel
is mounted — otherwise pages that consume no events (Zones, Plans) would close
it and the header indicator would claim to be reconnecting when nothing was
wrong.

`useLiveFleet` coalesces incoming updates into **one state commit per animation
frame**. The simulator emits ~70 events per tick; applying each as its own
`setState` re-renders the table 70 times in a burst.

The token goes in the query string (`/admin/events?token=…`) because
`EventSource` cannot set headers.

## Data provider

Custom, not `@refinedev/simple-rest`: our list endpoints return
`{ items, total }` rather than a bare array plus `x-total-count`.

Most pages **fetch directly through `apiFetch<T>`** with the shared types from
`@ozothunder/shared` rather than going through Refine's hooks. That keeps full type
safety end to end — the Refine data provider is generic in `TData extends
BaseRecord`, so it can only assert shapes, not prove them.

## Conventions

- UI strings are Russian. The rider app carries the RU/UZ toggle; the back
  office is RU only.
- Money is formatted with `formatSom` from `@ozothunder/shared` — never hand-rolled.
- Timestamps arrive UTC and are displayed in `Asia/Samarkand` via `lib/format.ts`.
- Status colours live **only** in `components/status.tsx`, so a colour never
  means two different things across the table, the map and the legend.
- Loading states are skeletons, never a spinner on white.

## Permissions

`providers/session.tsx` fetches `/admin/auth/me` **once** for the session and
exposes `can(section, level)`. Everything gates off that: `Shell`'s menu,
`RequireSection` on every route, and each page's action buttons. One fetch, not
one per component — separate requests resolve at different times and the menu
visibly flickers.

The decision is **`adminCan` from `@ozothunder/shared`**, the same function the API's
`requirePermission` middleware calls. Never re-implement the comparison here: a
button this panel hides has to be a request the API also refuses.

Three rules that are easy to undo:

- **A section without access is absent, not disabled.** It leaves the sidebar
  and its route redirects to the admin's first visible section. A greyed-out row
  still advertises a screen they cannot open.
- **Guard the index route too.** `/` is the dashboard, and it is the route every
  admin lands on after login — an unguarded one puts a permission error on the
  first screen a limited operator ever sees.
- **`admins` is owner-only and no tick grants it.** `RequireSection … owner`
  rather than a permission, matching `requireOwner` on the API.

## The fleet

Vehicles are created here and nowhere else — the seed makes none.
`components/VehicleFormModal.tsx` takes the QR code and IMEI off the hardware,
a model, a battery level, and a position clicked on a small Leaflet map with
lat/lon inputs beside it for a coordinate copied from elsewhere.

**«Симулировать» is off by default and that default is the feature.** On, the
fleet simulator drives the scooter; off, it keeps exactly the battery and
position it was given, because a real scooter's telemetry comes from the
scooter. The column in the table says which each one is.

Deleting is refused for a scooter with ride history — receipts still resolve
through it — so retiring a real one means «Обслуживание», not delete.

## The rental desk

Rent longer than 24 h is turned on **here and nowhere else** — the app sells
3 h, 5 h and 24 h and nothing more, because `GET /catalog/plans` drops
`officeOnly` plans. `components/GrantRentalModal.tsx` is that door, opened from two places
because there are two ways the conversation starts: from Абонементы when the
operator is already in the rentals table, and from a rider's row on
Пользователи when somebody is standing at the desk. Same component, the second
pre-fills the rider.

The modal shows the **end date before submitting**, because that is the figure
read out to the customer. It is computed from the duration, never picked — the
API derives the same one from the same number. The operator types **days**,
which is how the conversation at the desk goes; the wire carries
`durationMinutes`, because the app sells hours.

`Прекратить` on an active row is the only way a rental ends early. Both actions
write audit rows (`subscription.grant` / `subscription.cancel`), and the table
refreshes off `subscription.created` / `subscription.ended`.

## Zone editor

`leaflet-draw` predates react-leaflet's component model and mutates the map
imperatively, so `DrawControl` attaches it in an effect rather than rendering it.
Leaflet leaves a drawn ring open; GeoJSON requires it closed, so the first point
is appended before saving.

## Commands

```bash
pnpm -F @ozothunder/admin dev        # http://localhost:5173
pnpm -F @ozothunder/admin typecheck
```

Needs the API running (`pnpm -F @ozothunder/api dev`) and `VITE_API_URL` in
`apps/admin/.env`.
