import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminVehicle, ServerEvent } from '@ozothunder/shared';
import { apiFetch, type ListResponse } from './api.js';
import { useServerEvents } from './events.js';

/**
 * The fleet, loaded once then kept current from the SSE stream.
 *
 * Updates are coalesced into one state commit per animation frame. The
 * simulator emits ~70 events per tick, and applying each one as its own
 * setState would re-render the table 70 times in a burst.
 */
export function useLiveFleet(): {
  vehicles: AdminVehicle[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [vehicles, setVehicles] = useState<AdminVehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pending = useRef(new Map<string, Partial<AdminVehicle>>());
  const frame = useRef<number | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    apiFetch<ListResponse<AdminVehicle>>('/admin/vehicles')
      .then((response) => {
        setVehicles(response.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить парк');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  const flush = useCallback(() => {
    frame.current = null;
    if (pending.current.size === 0) return;

    const patches = pending.current;
    pending.current = new Map();

    setVehicles((current) =>
      current.map((vehicle) => {
        const patch = patches.get(vehicle.id);
        return patch === undefined ? vehicle : { ...vehicle, ...patch };
      }),
    );
  }, []);

  useServerEvents(
    useCallback(
      (event: ServerEvent) => {
        if (event.type !== 'vehicle.updated') return;

        pending.current.set(event.vehicleId, {
          status: event.status,
          batteryPct: event.batteryPct,
          location: event.location,
        });

        frame.current ??= requestAnimationFrame(flush);
      },
      [flush],
    ),
    ['vehicle.updated'],
  );

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { vehicles, isLoading, error, refetch: load };
}
