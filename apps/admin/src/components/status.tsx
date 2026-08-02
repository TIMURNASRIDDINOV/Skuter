import { Tag } from 'antd';
import type { Severity, VehicleStatus } from '@scoot/shared';
import { SEVERITY_RANK, VEHICLE_STATUS_SEVERITY } from '@scoot/shared';

/**
 * The severity axis itself now lives in `@scoot/shared`, because the rider app
 * has to agree with the back office about what is wrong with a scooter. It is
 * re-exported here so every existing import in this app keeps working, and so
 * this file remains the one place to look for "what does a status look like".
 *
 * Classification is shared; presentation is not. `SEVERITY_META` below is Ant
 * Design's palette and Russian labels — the rider app renders the same three
 * severities with React Native styles and its own RU/UZ strings.
 */
export type { Severity };
export { SEVERITY_RANK, VEHICLE_STATUS_SEVERITY };

export const SEVERITY_META: Record<Severity, { label: string; colour: string }> = {
  ok: { label: 'Норма', colour: '#52c41a' },
  watch: { label: 'Наблюдение', colour: '#faad14' },
  alarm: { label: 'Тревога', colour: '#f5222d' },
};

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
