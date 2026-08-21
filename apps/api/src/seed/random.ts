import type { GeoPolygon, LatLon } from '@ozothunder/shared';

/**
 * Deterministic randomness for the seed. Every `pnpm db:seed` must produce the
 * exact same fleet, so a demo can be rehearsed and then repeated in front of a
 * client without the map changing underneath.
 */

/** mulberry32 — small, fast, good enough for placing scooters. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type Rng = () => number;

const METRES_PER_DEGREE_LAT = 111_320;

function metresPerDegreeLon(lat: number): number {
  return METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Offset a point by a north/east displacement in metres. */
export function offsetMetres(origin: LatLon, eastM: number, northM: number): LatLon {
  return {
    lat: origin.lat + northM / METRES_PER_DEGREE_LAT,
    lon: origin.lon + eastM / metresPerDegreeLon(origin.lat),
  };
}

/**
 * Uniform sample inside a disc. The sqrt is what stops everything bunching at
 * the centre — without it the fleet looks like a bullseye rather than a
 * neighbourhood.
 */
export function scatterInDisc(centre: LatLon, radiusM: number, rng: Rng): LatLon {
  const radius = radiusM * Math.sqrt(rng());
  const angle = 2 * Math.PI * rng();
  return offsetMetres(centre, radius * Math.cos(angle), radius * Math.sin(angle));
}

/**
 * Sample along a line between two points with a little lateral jitter — used
 * to lay part of each cluster along a street instead of scattering everything
 * radially, which is what makes the map read as a real fleet.
 */
export function scatterAlongLine(
  from: LatLon,
  to: LatLon,
  jitterM: number,
  rng: Rng,
): LatLon {
  const t = rng();
  const base: LatLon = {
    lat: from.lat + (to.lat - from.lat) * t,
    lon: from.lon + (to.lon - from.lon) * t,
  };
  const lateral = (rng() - 0.5) * 2 * jitterM;
  const bearing = Math.atan2(to.lat - from.lat, to.lon - from.lon) + Math.PI / 2;
  return offsetMetres(base, lateral * Math.cos(bearing), lateral * Math.sin(bearing));
}

/**
 * Regular polygon around a centre, as a closed counter-clockwise GeoJSON ring.
 * Used for parking, forbidden and service-area geometry.
 */
export function polygonAround(centre: LatLon, radiusM: number, sides = 8): GeoPolygon {
  const ring: [number, number][] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (2 * Math.PI * i) / sides;
    const point = offsetMetres(centre, radiusM * Math.cos(angle), radiusM * Math.sin(angle));
    ring.push([round6(point.lon), round6(point.lat)]);
  }
  const first = ring[0];
  if (first === undefined) throw new Error('polygonAround produced an empty ring');
  ring.push([first[0], first[1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

/** Axis-aligned polygon from a lon/lat bounding box, closed counter-clockwise. */
export function polygonFromBounds(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}): GeoPolygon {
  const { west, south, east, north } = bounds;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

/** Six decimal places is ~10 cm — more than enough, and keeps payloads small. */
export function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
