# packages/shared — schemas, types, domain constants

The single source of truth. The API, the rider app and the admin panel all
import from here. **A type defined in this package must never be redefined in a
consumer.** If two apps need the same shape, it belongs here.

## Layout

```
src/
  constants.ts   Bukhara clusters, tick interval, timezone, battery thresholds
  geo.ts         GeoJSON schemas + haversine helpers
  money.ts       tiyin integers -> "12 500 so'm"
  pricing.ts     calculateRideCost — THE ride cost function
  schemas/       one file per domain area, plus events.ts for the SSE union
  index.ts       flat re-export of everything
```

## Rules

**Zod 4.** String formats are top-level: `z.uuid()`, `z.email()`,
`z.iso.datetime()`, `z.int()` — not `z.string().uuid()`.

**Schema first, type inferred.** Declare the zod schema, then
`export type X = z.infer<typeof xSchema>`. Never hand-write a type that a schema
already describes.

**Coordinates are `[longitude, latitude]`** in GeoJSON — the reverse of how they
are spoken. `latLonSchema` is the ergonomic `{ lat, lon }` form the clients use;
`pointToLatLon` / `latLonToPoint` convert.

**Money is integer tiyin.** 1 so'm = 100 tiyin. Never floats, never so'm in a
variable. `formatSom` is the only thing that produces a display string, and it
groups with U+00A0 so amounts never wrap mid-number.

**`calculateRideCost` is pure and is the only cost implementation.** The API
charges with it and the app tickers with it, so a receipt cannot disagree with
what the rider watched during the ride. It has no clock, no I/O, no randomness.
Unit tested in `pricing.test.ts` — extend those tests before changing behaviour.

## Build

Built with tsup to dual ESM + CJS with `.d.ts`, so Node (API), Vite (admin) and
Metro (mobile) all resolve it. **Consumers read `dist/`, not `src/`** — run
`pnpm -F @ozothunder/shared build` after changing anything here, or `pnpm -F
@ozothunder/shared dev` to watch.

```bash
pnpm -F @ozothunder/shared build
pnpm -F @ozothunder/shared test
pnpm -F @ozothunder/shared typecheck
```
