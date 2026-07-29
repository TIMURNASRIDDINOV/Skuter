import { TASHKENT_MAP_CENTER, TASHKENT_MAP_DELTA } from '@scoot/shared';
import type { LngLatBounds } from '@maplibre/maplibre-react-native';
import { Dimensions } from 'react-native';

/**
 * OpenFreeMap's Liberty style — free vector tiles with no API key, no
 * registration and no usage limits (https://openfreemap.org). Swapping the
 * basemap is a one-line change here.
 */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * MapLibre zoom that shows `longitudeDelta` degrees across the screen.
 * Zoom z spans 360 · (widthPt / 512) / 2^z degrees (512 px world tiles), so
 * the screen-width term is required to reproduce the react-native-maps
 * regions these constants were calibrated against. Evaluated at module load —
 * fine, the app is portrait-locked.
 */
function lonDeltaToZoom(longitudeDelta: number): number {
  return Math.log2((360 * Dimensions.get('window').width) / (512 * longitudeDelta));
}

/** Whole-city view — mirrors the old 0.22° initial region. */
export const CITY_ZOOM = lonDeltaToZoom(TASHKENT_MAP_DELTA.longitudeDelta);

/** Close-up on one vehicle (old 0.01° region). */
export const FOCUS_ZOOM = lonDeltaToZoom(0.01);

/** Following the scooter during a ride (old 0.008° region). */
export const RIDE_ZOOM = lonDeltaToZoom(0.008);

/** Initial viewport bounds, for clustering before the first camera event. */
export const INITIAL_BOUNDS: LngLatBounds = [
  TASHKENT_MAP_CENTER.lon - TASHKENT_MAP_DELTA.longitudeDelta / 2,
  TASHKENT_MAP_CENTER.lat - TASHKENT_MAP_DELTA.latitudeDelta / 2,
  TASHKENT_MAP_CENTER.lon + TASHKENT_MAP_DELTA.longitudeDelta / 2,
  TASHKENT_MAP_CENTER.lat + TASHKENT_MAP_DELTA.latitudeDelta / 2,
];
