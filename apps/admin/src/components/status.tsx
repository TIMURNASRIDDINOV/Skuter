import { Tag } from 'antd';
import type { VehicleStatus } from '@scoot/shared';

/**
 * Severity is a second axis over status: status says *what* a vehicle is,
 * severity says *how much it should worry you*. The dashboard ranks by
 * severity, so without this every screen would have to re-decide for itself
 * whether `maintenance` is worse than `offline`.
 */
export type Severity = 'ok' | 'watch' | 'alarm';

export const SEVERITY_META: Record<Severity, { label: string; colour: string }> = {
  ok: { label: 'Норма', colour: '#52c41a' },
  watch: { label: 'Наблюдение', colour: '#faad14' },
  alarm: { label: 'Тревога', colour: '#f5222d' },
};

/** Rank used to sort mixed lists of problems most-urgent first. */
export const SEVERITY_RANK: Record<Severity, number> = { alarm: 0, watch: 1, ok: 2 };

/**
 * One definition of what each vehicle status looks like, used by the tables,
 * the map pins and the legend — so a colour never means two things.
 */
export const VEHICLE_STATUS_META: Record<
  VehicleStatus,
  { label: string; colour: string; tag: string }
> = {
  available: { label: 'Свободен', colour: '#52c41a', tag: 'success' },
  in_use: { label: 'В поездке', colour: '#1677ff', tag: 'processing' },
  reserved: { label: 'Забронирован', colour: '#722ed1', tag: 'purple' },
  low_battery: { label: 'Низкий заряд', colour: '#faad14', tag: 'warning' },
  offline: { label: 'Не на связи', colour: '#8c8c8c', tag: 'default' },
  maintenance: { label: 'Обслуживание', colour: '#f5222d', tag: 'error' },
};

/**
 * `reserved` is deliberately `ok`: a held scooter is the system working, not a
 * fault. `low_battery` is `watch` rather than `alarm` because the fleet always
 * has some — it is a dispatch queue, not an incident.
 */
export const VEHICLE_STATUS_SEVERITY: Record<VehicleStatus, Severity> = {
  available: 'ok',
  in_use: 'ok',
  reserved: 'ok',
  low_battery: 'watch',
  maintenance: 'watch',
  offline: 'alarm',
};

export function VehicleStatusTag({ status }: { status: VehicleStatus }): React.ReactElement {
  const meta = VEHICLE_STATUS_META[status];
  return <Tag color={meta.tag}>{meta.label}</Tag>;
}

export const RIDE_STATUS_META: Record<string, { label: string; tag: string }> = {
  active: { label: 'Активна', tag: 'processing' },
  completed: { label: 'Завершена', tag: 'success' },
  cancelled: { label: 'Отменена', tag: 'default' },
};

export function RideStatusTag({ status }: { status: string }): React.ReactElement {
  const meta = RIDE_STATUS_META[status] ?? { label: status, tag: 'default' };
  return <Tag color={meta.tag}>{meta.label}</Tag>;
}

export const SUBSCRIPTION_STATUS_META: Record<string, { label: string; tag: string }> = {
  active: { label: 'Активна', tag: 'success' },
  expired: { label: 'Истекла', tag: 'default' },
  cancelled: { label: 'Отменена', tag: 'error' },
};

export function SubscriptionStatusTag({ status }: { status: string }): React.ReactElement {
  const meta = SUBSCRIPTION_STATUS_META[status] ?? { label: status, tag: 'default' };
  return <Tag color={meta.tag}>{meta.label}</Tag>;
}

export const ZONE_KIND_META: Record<string, { label: string; colour: string }> = {
  service: { label: 'Зона обслуживания', colour: '#1677ff' },
  parking: { label: 'Парковка', colour: '#52c41a' },
  forbidden: { label: 'Запрещено', colour: '#f5222d' },
};
