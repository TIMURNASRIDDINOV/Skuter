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
    format.ts        dates in Asia/Tashkent, durations, distances
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
`@scoot/shared` rather than going through Refine's hooks. That keeps full type
safety end to end — the Refine data provider is generic in `TData extends
BaseRecord`, so it can only assert shapes, not prove them.

## Conventions

- UI strings are Russian. The rider app carries the RU/UZ toggle; the back
  office is RU only.
- Money is formatted with `formatSom` from `@scoot/shared` — never hand-rolled.
- Timestamps arrive UTC and are displayed in `Asia/Tashkent` via `lib/format.ts`.
- Status colours live **only** in `components/status.tsx`, so a colour never
  means two different things across the table, the map and the legend.
- Loading states are skeletons, never a spinner on white.

## Zone editor

`leaflet-draw` predates react-leaflet's component model and mutates the map
imperatively, so `DrawControl` attaches it in an effect rather than rendering it.
Leaflet leaves a drawn ring open; GeoJSON requires it closed, so the first point
is appended before saving.

## Commands

```bash
pnpm -F @scoot/admin dev        # http://localhost:5173
pnpm -F @scoot/admin typecheck
```

Needs the API running (`pnpm -F @scoot/api dev`) and `VITE_API_URL` in
`apps/admin/.env`.
