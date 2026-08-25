import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Form, InputNumber, Modal, Select, Spin, Typography } from 'antd';
import {
  MINUTES_PER_DAY,
  type AdminVehicle,
  type Plan,
  type SubscriptionDetail,
  type User,
  type VehicleStatus,
} from '@ozothunder/shared';
import { apiFetch, ApiRequestError, type ListResponse } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { VEHICLE_STATUS_META } from './status.js';

const MS_PER_MINUTE = 60 * 1000;

/**
 * Order the scooter list puts them in — the ones an operator would reach for
 * first, then the rest.
 *
 * Deliberately a *sort*, not a filter. This list used to ask the API for
 * `?status=available` only, which is wrong twice over: the operator granting a
 * long rental is standing next to the scooter and knows better than the
 * fleet's telemetry does, and a simulated fleet that has drifted offline
 * emptied the dropdown completely — no scooters, no rental, no explanation.
 * `in_use` is the one genuine exclusion; that scooter is out with somebody.
 */
const STATUS_ORDER: Record<VehicleStatus, number> = {
  available: 0,
  low_battery: 1,
  offline: 2,
  reserved: 3,
  maintenance: 4,
  in_use: 5,
};

/**
 * Turning long-term rent on for someone standing at the desk.
 *
 * This is the only door an office-only rental comes through — the rider app
 * sells 3, 5 and 24 hours, and nothing longer. The form is ordered the way the
 * conversation goes: who is this, which scooter are they taking, on what
 * terms, until when.
 *
 * The end date is shown before submitting rather than after, because it is the
 * one thing the customer is told out loud.
 */
export function GrantRentalModal({
  open,
  rider,
  onClose,
  onGranted,
}: {
  open: boolean;
  /** Pre-filled when opened from a row on Пользователи. */
  rider?: User | null;
  onClose: () => void;
  onGranted: () => void;
}): React.ReactElement {
  const [userId, setUserId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  // Days in the form, minutes on the wire. The office sells weeks and
  // fortnights, so days is the unit the conversation happens in; the API
  // stores every rental length in minutes because the app sells hours.
  const [durationDays, setDurationDays] = useState<number | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [vehicles, setVehicles] = useState<AdminVehicle[]>([]);
  const [takenVehicleIds, setTakenVehicleIds] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<Plan[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchUsers = useCallback((search: string) => {
    setSearching(true);
    const query = search.trim() === '' ? '' : `?search=${encodeURIComponent(search.trim())}`;
    apiFetch<ListResponse<User>>(`/admin/users${query}`)
      .then((response) => {
        setUsers(response.items);
      })
      .catch(() => {
        setUsers([]);
      })
      .finally(() => {
        setSearching(false);
      });
  }, []);

  // Reset to a clean form every time it opens — a modal that remembers the
  // previous customer is how the wrong person gets a scooter.
  useEffect(() => {
    if (!open) return;

    setError(null);
    setUserId(rider?.id ?? null);
    setVehicleId(null);
    setUsers(rider === null || rider === undefined ? [] : [rider]);

    searchUsers('');

    // The whole fleet, minus whatever is already spoken for. The API refuses a
    // scooter on someone else's subscription anyway; excluding it here means
    // the operator never picks one only to be told no.
    void apiFetch<ListResponse<AdminVehicle>>('/admin/vehicles').then((response) => {
      setVehicles(
        [...response.items].sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            a.qrCode.localeCompare(b.qrCode),
        ),
      );
    });

    void apiFetch<ListResponse<SubscriptionDetail>>('/admin/subscriptions').then((response) => {
      setTakenVehicleIds(
        new Set(
          response.items
            .filter((row) => row.status === 'active')
            .map((row) => row.vehicle.id),
        ),
      );
    });

    void apiFetch<ListResponse<Plan>>('/admin/plans').then((response) => {
      // Office-only plans first: they are what this modal exists for, and the
      // app cannot sell one. Pay-as-you-go has no rental period at all.
      const grantable = response.items
        .filter((plan) => plan.durationMinutes !== null)
        .sort((a, b) => Number(b.officeOnly) - Number(a.officeOnly));
      setPlans(grantable);

      const preferred = grantable.find((plan) => plan.officeOnly) ?? grantable[0] ?? null;
      setPlanId(preferred?.id ?? null);
      setDurationDays(toDays(preferred?.durationMinutes ?? null));
    });
  }, [open, rider, searchUsers]);

  // Out on a ride is the one state that genuinely rules a scooter out — it is
  // physically with another rider. Everything else is the operator's call.
  const selectableVehicles = vehicles.filter(
    (vehicle) => vehicle.status !== 'in_use' && !takenVehicleIds.has(vehicle.id),
  );

  const selectedPlan = plans.find((plan) => plan.id === planId) ?? null;
  const selectedVehicle = selectableVehicles.find((v) => v.id === vehicleId) ?? null;
  const selectedUser = users.find((user) => user.id === userId) ?? null;

  // Computed, never chosen — the API derives the same figure from the same
  // duration. Shown here because it is the date read out to the customer.
  const durationMinutes = durationDays === null ? null : durationDays * MINUTES_PER_DAY;

  const endsAt = useMemo(
    () =>
      durationMinutes === null
        ? null
        : new Date(Date.now() + durationMinutes * MS_PER_MINUTE).toISOString(),
    [durationMinutes],
  );

  const submit = (): void => {
    if (userId === null || vehicleId === null || planId === null) return;
    setSubmitting(true);
    setError(null);

    apiFetch('/admin/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ userId, vehicleId, planId, durationMinutes }),
    })
      .then(() => {
        onGranted();
        onClose();
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiRequestError ? cause.message : 'Не удалось включить аренду',
        );
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <Modal
      open={open}
      title="Включить аренду"
      okText="Включить"
      cancelText="Отмена"
      onOk={submit}
      onCancel={onClose}
      confirmLoading={submitting}
      okButtonProps={{ disabled: userId === null || vehicleId === null || planId === null }}
      destroyOnHidden
    >
      <Form layout="vertical" size="small">
        <Form.Item label="Клиент" required>
          <Select
            showSearch
            value={userId}
            placeholder="Телефон или имя"
            filterOption={false}
            notFoundContent={searching ? <Spin size="small" /> : 'Никого не найдено'}
            onSearch={searchUsers}
            onChange={setUserId}
            options={users.map((user) => ({
              value: user.id,
              label: `${user.phone ?? user.email ?? 'Telegram'}${
                user.name === null ? '' : ` — ${user.name}`
              }`,
            }))}
          />
        </Form.Item>

        <Form.Item
          label="Самокат"
          required
          help={
            selectableVehicles.length === 0 && vehicles.length > 0
              ? 'Все самокаты сейчас заняты арендой или поездкой.'
              : undefined
          }
        >
          <Select
            showSearch
            value={vehicleId}
            placeholder="Номер самоката"
            optionFilterProp="label"
            notFoundContent={vehicles.length === 0 ? <Spin size="small" /> : 'Ничего не найдено'}
            onChange={setVehicleId}
            options={selectableVehicles.map((vehicle) => ({
              value: vehicle.id,
              // The status is spelled out rather than filtered on: a scooter
              // that reads `offline` may be sitting in the office in perfect
              // order, and the person handing it over can see that.
              label: `${vehicle.qrCode} — ${vehicle.model} · ${String(vehicle.batteryPct)}% · ${
                VEHICLE_STATUS_META[vehicle.status].label
              }`,
            }))}
          />
        </Form.Item>

        <Form.Item
          label="Тариф"
          required
          help={
            selectedPlan?.officeOnly === true
              ? 'Тариф только для офиса — в приложении его купить нельзя.'
              : 'Этот тариф клиент может купить и сам, в приложении.'
          }
        >
          <Select
            value={planId}
            onChange={(next: string) => {
              setPlanId(next);
              setDurationDays(toDays(plans.find((plan) => plan.id === next)?.durationMinutes ?? null));
            }}
            options={plans.map((plan) => ({
              value: plan.id,
              label: `${plan.name} — ${formatSom(plan.price)}`,
            }))}
          />
        </Form.Item>

        <Form.Item
          label="Срок, дней"
          help="По умолчанию — срок тарифа. Измените, если клиент оплатил другой период."
        >
          <InputNumber
            min={1}
            max={365}
            value={durationDays}
            onChange={setDurationDays}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="Аренда закончится" style={{ marginBottom: 8 }}>
          <Typography.Text strong>{formatDateTime(endsAt)}</Typography.Text>
        </Form.Item>
      </Form>

      {selectedUser !== null && selectedVehicle !== null && selectedPlan !== null && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: error === null ? 0 : 12 }}>
          {selectedUser.phone ?? selectedUser.name ?? 'Клиент'} получает самокат{' '}
          <Typography.Text strong>{selectedVehicle.qrCode}</Typography.Text> до{' '}
          <Typography.Text strong>{formatDateTime(endsAt)}</Typography.Text>.
          Самокат исчезнет с карты для остальных.
        </Typography.Paragraph>
      )}

      {error !== null && <Alert type="error" showIcon message={error} />}
    </Modal>
  );
}

/**
 * Minutes to whole days for the form's own input.
 *
 * Rounds up, so a plan the app sells by the hour still offers a sane default
 * if an operator ever grants one: three hours becomes "1 day", which they then
 * correct, rather than an empty field with no end date to read out.
 */
function toDays(minutes: number | null): number | null {
  return minutes === null ? null : Math.max(1, Math.ceil(minutes / MINUTES_PER_DAY));
}
