import { LOW_BATTERY_THRESHOLD_PCT, isPointInPolygon } from '@scoot/shared';
import type { AdminVehicle, Ride, Zone } from '@scoot/shared';
import type { Severity } from '../components/status.js';
import { SEVERITY_RANK } from '../components/status.js';
import { plural } from './format.js';

/**
 * What needs an operator's attention right now, derived on the client from
 * data the dashboard already loads.
 *
 * Every kind here is computed from fields we genuinely have. The reference
 * panel (see docs/reference-review.md §2.4) carries a much larger alarm
 * taxonomy — battery removal, helmet faults, controller state — which we do
 * not model. Those are deliberately absent rather than faked.
 */

export type AnomalyKind =
  | 'vehicle_offline'
  | 'vehicle_outside_service'
  | 'vehicle_maintenance'
  | 'vehicle_low_battery'
  | 'ride_overlong'
  | 'ride_stalled';

export interface Anomaly {
  /** Stable across refreshes, so React keys and flash animations survive. */
  id: string;
  kind: AnomalyKind;
  severity: Severity;
  /** Id of the vehicle at fault, so a table row can find its own problems. */
  vehicleId: string;
  /** The thing at fault, e.g. `SCOOT-0042`. */
  subject: string;
  /** What is wrong with it, already localised. */
  detail: string;
  /** Where clicking the row should go. */
  href: string;
}

/** Operator-tunable, mirroring how the reference exposes its thresholds. */
export interface AnomalyThresholds {
  /** An active ride longer than this is suspicious. */
  overlongRideMinutes: number;
  /** An active ride that has barely moved after this long is stuck. */
  stalledRideMinutes: number;
}

export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  overlongRideMinutes: 90,
  stalledRideMinutes: 10,
};

/** Below this, an active ride counts as "has not really moved". */
const STALLED_RIDE_DISTANCE_M = 50;

export interface AnomalyInput {
  vehicles: readonly AdminVehicle[];
  zones: readonly Zone[];
  activeRides: readonly (Ride & { vehicleQrCode: string })[];
  thresholds: AnomalyThresholds;
}

export function deriveAnomalies({
  vehicles,
  zones,
  activeRides,
  thresholds,
}: AnomalyInput): Anomaly[] {
  const found: Anomaly[] = [];
  const serviceZones = zones.filter((zone) => zone.kind === 'service');

  for (const vehicle of vehicles) {
    if (vehicle.status === 'offline') {
      found.push({
        id: `offline:${vehicle.id}`,
        kind: 'vehicle_offline',
        vehicleId: vehicle.id,
        severity: 'alarm',
        subject: vehicle.qrCode,
        detail: 'не выходит на связь',
        href: '/vehicles',
      });
    }

    // Only meaningful once service zones exist — with none loaded, every
    // vehicle would read as outside the service area.
    if (serviceZones.length > 0 && !isInAnyZone(vehicle, serviceZones)) {
      found.push({
        id: `outside:${vehicle.id}`,
        kind: 'vehicle_outside_service',
        vehicleId: vehicle.id,
        severity: 'alarm',
        subject: vehicle.qrCode,
        detail: 'за пределами зоны обслуживания',
        href: '/vehicles',
      });
    }

    if (vehicle.status === 'maintenance') {
      found.push({
        id: `maintenance:${vehicle.id}`,
        kind: 'vehicle_maintenance',
        vehicleId: vehicle.id,
        severity: 'watch',
        subject: vehicle.qrCode,
        detail: 'на обслуживании',
        href: '/vehicles',
      });
    }

    // `low_battery` is a status, but a scooter can also be in use and draining;
    // the threshold catches both without double-reporting.
    if (vehicle.status !== 'offline' && vehicle.batteryPct <= LOW_BATTERY_THRESHOLD_PCT) {
      found.push({
        id: `battery:${vehicle.id}`,
        kind: 'vehicle_low_battery',
        vehicleId: vehicle.id,
        severity: 'watch',
        subject: vehicle.qrCode,
        detail: `заряд ${String(vehicle.batteryPct)} %`,
        href: '/vehicles',
      });
    }
  }

  for (const ride of activeRides) {
    const minutes = ride.durationS / 60;

    if (minutes >= thresholds.overlongRideMinutes) {
      found.push({
        id: `overlong:${ride.id}`,
        kind: 'ride_overlong',
        vehicleId: ride.vehicleId,
        severity: 'alarm',
        subject: ride.vehicleQrCode,
        detail: `поездка идёт ${String(Math.floor(minutes))} мин`,
        href: '/rides',
      });
    } else if (
      minutes >= thresholds.stalledRideMinutes &&
      ride.distanceM < STALLED_RIDE_DISTANCE_M
    ) {
      found.push({
        id: `stalled:${ride.id}`,
        kind: 'ride_stalled',
        vehicleId: ride.vehicleId,
        severity: 'alarm',
        subject: ride.vehicleQrCode,
        detail: `поездка ${String(Math.floor(minutes))} мин без движения`,
        href: '/rides',
      });
    }
  }

  return found.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.subject.localeCompare(b.subject),
  );
}

function isInAnyZone(vehicle: AdminVehicle, zones: readonly Zone[]): boolean {
  return zones.some((zone) => isPointInPolygon(vehicle.location, zone.geom));
}

export function countBySeverity(anomalies: readonly Anomaly[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { ok: 0, watch: 0, alarm: 0 };
  for (const anomaly of anomalies) counts[anomaly.severity] += 1;
  return counts;
}

/**
 * A row in the attention list: either one named vehicle, or a count of them.
 *
 * Naming the vehicle only helps while there are few. Forty rows reading
 * "outside the service area" is the reference panel's wall of counters wearing
 * a different hat — at that point the useful fact is the number and the fact
 * that it is systemic, so the rows collapse into one summary line.
 */
export interface AttentionRow {
  id: string;
  severity: Severity;
  count: number;
  /** The vehicle code, or null when this row summarises many. */
  subject: string | null;
  detail: string;
  href: string;
}

/** Above this many of one kind, name the count instead of each vehicle. */
const GROUP_ABOVE = 3;

export function toAttentionRows(anomalies: readonly Anomaly[]): AttentionRow[] {
  const byKind = new Map<AnomalyKind, Anomaly[]>();
  for (const anomaly of anomalies) {
    const bucket = byKind.get(anomaly.kind);
    if (bucket === undefined) byKind.set(anomaly.kind, [anomaly]);
    else bucket.push(anomaly);
  }

  const rows: AttentionRow[] = [];

  for (const [kind, group] of byKind) {
    const first = group[0];
    if (first === undefined) continue;

    if (group.length <= GROUP_ABOVE) {
      for (const anomaly of group) {
        rows.push({
          id: anomaly.id,
          severity: anomaly.severity,
          count: 1,
          subject: anomaly.subject,
          detail: anomaly.detail,
          href: anomaly.href,
        });
      }
      continue;
    }

    rows.push({
      id: `group:${kind}`,
      severity: first.severity,
      count: group.length,
      subject: null,
      detail: summarise(kind, group.length),
      href: first.href,
    });
  }

  // Grouped rows first within a severity — a systemic problem outranks a
  // single stranded scooter.
  return rows.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.count - a.count ||
      (a.subject ?? '').localeCompare(b.subject ?? ''),
  );
}

function summarise(kind: AnomalyKind, count: number): string {
  const scooters = `${String(count)} ${plural(count, 'самокат', 'самоката', 'самокатов')}`;

  switch (kind) {
    case 'vehicle_outside_service':
      return `${scooters} за пределами зоны обслуживания`;
    case 'vehicle_offline':
      return `${scooters} не выходят на связь`;
    case 'vehicle_low_battery':
      return `${scooters} с низким зарядом`;
    case 'vehicle_maintenance':
      return `${scooters} на обслуживании`;
    case 'ride_overlong':
      return `${String(count)} ${plural(count, 'долгая поездка', 'долгие поездки', 'долгих поездок')}`;
    case 'ride_stalled':
      return `${String(count)} ${plural(count, 'поездка', 'поездки', 'поездок')} без движения`;
  }
}
