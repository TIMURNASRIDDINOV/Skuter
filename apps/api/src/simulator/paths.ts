import { haversineDistanceM, type LatLon } from '@ozothunder/shared';
import { offsetMetres, type Rng } from '../seed/random.js';

/**
 * Street-like route generation.
 *
 * A straight line between two points reads as obviously fake on a map. Real
 * rides follow a block grid: a run along one street, a turn, a run along the
 * next. These routes are built as an axis-aligned staircase with jittered leg
 * lengths and a slight wander, then densified so the polyline animates
 * smoothly and `rides.path` renders as a plausible track.
 */

/** Spacing between interpolated points, in metres. */
const DENSIFY_STEP_M = 20;

/** Perpendicular wander applied per leg, so legs are not perfectly straight. */
const LEG_JITTER_M = 18;

interface Displacement {
  east: number;
  north: number;
}

function displacement(from: LatLon, to: LatLon): Displacement {
  // Signed metre offsets, using the same flat-earth approximation as the seed.
  const north = haversineDistanceM(from, { lat: to.lat, lon: from.lon }) * (to.lat >= from.lat ? 1 : -1);
  const east = haversineDistanceM(from, { lat: from.lat, lon: to.lon }) * (to.lon >= from.lon ? 1 : -1);
  return { east, north };
}

/**
 * Build the corner points of a staircase from `from` to `to`.
 *
 * Alternates east/west and north/south legs, consuming a jittered share of the
 * remaining displacement each time, so no two routes turn in the same places.
 */
function staircaseCorners(from: LatLon, to: LatLon, rng: Rng): LatLon[] {
  const total = displacement(from, to);
  const legs = 3 + Math.floor(rng() * 4); // 3–6 turns

  const corners: LatLon[] = [from];
  let current = from;
  let remainingEast = total.east;
  let remainingNorth = total.north;

  // Start on whichever axis has further to go — that is how people actually
  // ride, taking the long street first.
  let horizontal = Math.abs(total.east) >= Math.abs(total.north);

  for (let leg = 0; leg < legs; leg += 1) {
    const isFinalPair = leg >= legs - 2;
    // Consume 45–85% of what is left, except at the end where the remainder
    // must be spent so the route actually arrives.
    const share = isFinalPair ? 1 : 0.45 + rng() * 0.4;

    if (horizontal) {
      const step = remainingEast * share;
      remainingEast -= step;
      const wander = (rng() - 0.5) * 2 * LEG_JITTER_M;
      current = offsetMetres(current, step, wander);
    } else {
      const step = remainingNorth * share;
      remainingNorth -= step;
      const wander = (rng() - 0.5) * 2 * LEG_JITTER_M;
      current = offsetMetres(current, wander, step);
    }

    corners.push(current);
    horizontal = !horizontal;
  }

  // Close any rounding gap so the route ends where it was asked to.
  corners.push(to);
  return corners;
}

/** Interpolate along a corner list so points sit ~DENSIFY_STEP_M apart. */
function densify(corners: readonly LatLon[]): LatLon[] {
  const points: LatLon[] = [];

  for (let i = 1; i < corners.length; i += 1) {
    const start = corners[i - 1];
    const end = corners[i];
    if (start === undefined || end === undefined) continue;

    const legLength = haversineDistanceM(start, end);
    const steps = Math.max(1, Math.round(legLength / DENSIFY_STEP_M));

    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      points.push({
        lat: start.lat + (end.lat - start.lat) * t,
        lon: start.lon + (end.lon - start.lon) * t,
      });
    }
  }

  const last = corners.at(-1);
  if (last !== undefined) points.push(last);
  return points;
}

/**
 * A ridable route between two points, as a densified street-like polyline.
 * Always at least two points, so it is a valid GeoJSON LineString.
 */
export function generateStreetRoute(from: LatLon, to: LatLon, rng: Rng): LatLon[] {
  const route = densify(staircaseCorners(from, to, rng));
  return route.length >= 2 ? route : [from, to];
}

/**
 * Pick a destination for a spontaneous ride: a bearing at a plausible distance
 * for a city scooter trip.
 */
export function pickDestination(from: LatLon, rng: Rng): LatLon {
  const distanceM = 700 + rng() * 1800; // 0.7–2.5 km
  const bearing = rng() * 2 * Math.PI;
  return offsetMetres(from, distanceM * Math.cos(bearing), distanceM * Math.sin(bearing));
}

/** Realistic e-scooter cruising speed, in metres per second (14–22 km/h). */
export function pickSpeedMps(rng: Rng): number {
  return 4 + rng() * 2;
}
