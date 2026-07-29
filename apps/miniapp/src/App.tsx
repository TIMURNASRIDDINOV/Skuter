import type {
  ActiveRide,
  CommandResult,
  ParkingCheck,
  Plan,
  Ride,
  RideReceipt,
  Vehicle,
  Zone,
} from '@scoot/shared';
import { SIMULATOR_TICK_MS } from '@scoot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ListResponse } from './api';
import { ApiRequestError, apiFetch, clearToken, hasToken, registerUnauthorizedHandler } from './api';
import { Login } from './screens/Login';
import { MapScreen } from './screens/MapScreen';
import { ReceiptScreen } from './screens/ReceiptScreen';
import { RideScreen } from './screens/RideScreen';
import { haptic } from './telegram';

export function App() {
  const [authed, setAuthed] = useState(hasToken());
  const [receipt, setReceipt] = useState<RideReceipt | null>(null);
  const [blocked, setBlocked] = useState<ParkingCheck | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [beepNote, setBeepNote] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      clearToken();
      setAuthed(false);
    });
  }, []);

  const vehiclesQuery = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => apiFetch<ListResponse<Vehicle>>('/vehicles'),
    refetchInterval: 5000,
    enabled: authed,
  });
  const zonesQuery = useQuery({
    queryKey: ['zones'],
    queryFn: () => apiFetch<ListResponse<Zone>>('/catalog/zones'),
    staleTime: 60_000,
    enabled: authed,
  });
  const plansQuery = useQuery({
    queryKey: ['plans'],
    queryFn: () => apiFetch<ListResponse<Plan>>('/catalog/plans'),
    staleTime: 5 * 60_000,
    enabled: authed,
  });
  const activeRideQuery = useQuery({
    queryKey: ['activeRide'],
    queryFn: () => apiFetch<{ ride: ActiveRide | null }>('/rides/active'),
    refetchInterval: SIMULATOR_TICK_MS,
    enabled: authed,
  });

  const startRide = useMutation({
    mutationFn: (body: { qrCode: string; planId: string }) =>
      apiFetch<{ ride: Ride; unlockLatencyMs: number }>('/rides', { method: 'POST', body }),
    onSuccess: () => {
      haptic('success');
      setUnlockError(null);
      void queryClient.invalidateQueries({ queryKey: ['activeRide'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (error) => {
      haptic('error');
      setUnlockError(
        error instanceof ApiRequestError && error.code === 'unlock_failed'
          ? 'Самокат не ответил. Это бывает — попробуйте ещё раз.'
          : error instanceof ApiRequestError
            ? error.message
            : 'Не удалось разблокировать',
      );
    },
  });

  const endRide = useMutation({
    mutationFn: ({ rideId, location }: { rideId: string; location: { lat: number; lon: number } }) =>
      apiFetch<RideReceipt>(`/rides/${rideId}/end`, { method: 'POST', body: { location } }),
    onSuccess: (result) => {
      haptic('success');
      setBlocked(null);
      setReceipt(result);
      void queryClient.invalidateQueries({ queryKey: ['activeRide'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (error) => {
      haptic('error');
      if (error instanceof ApiRequestError) {
        const details = error.details as { check?: ParkingCheck } | null;
        if (details?.check !== undefined) {
          setBlocked(details.check);
          return;
        }
      }
      // Already ended elsewhere — the active-ride poll will take over.
    },
  });

  const beep = useMutation({
    mutationFn: (rideId: string) =>
      apiFetch<CommandResult>(`/rides/${rideId}/beep`, { method: 'POST' }),
    onSuccess: (result) => {
      setBeepNote(result.ok ? 'Самокат пискнул 📢' : 'Сигнал не прошёл');
      setTimeout(() => setBeepNote(null), 2500);
    },
    onError: () => {
      setBeepNote('Сигнал не прошёл');
      setTimeout(() => setBeepNote(null), 2500);
    },
  });

  if (!authed) {
    return (
      <Login
        onLoggedIn={() => {
          setAuthed(true);
          void queryClient.invalidateQueries();
        }}
      />
    );
  }

  if (receipt !== null) {
    return <ReceiptScreen receipt={receipt} onDone={() => setReceipt(null)} />;
  }

  const ride = activeRideQuery.data?.ride ?? null;
  const zones = zonesQuery.data?.items ?? [];
  const plans = plansQuery.data?.items ?? [];
  const perMinutePlan = plans.find((plan) => plan.kind === 'per_minute') ?? null;

  if (ride !== null) {
    return (
      <RideScreen
        ride={ride}
        zones={zones}
        plan={plans.find((plan) => plan.id === ride.planId) ?? null}
        ending={endRide.isPending}
        blocked={blocked}
        onEnd={(location) => endRide.mutate({ rideId: ride.id, location })}
        onDismissBlocked={() => setBlocked(null)}
        onBeep={() => beep.mutate(ride.id)}
        beepNote={beepNote}
      />
    );
  }

  return (
    <MapScreen
      vehicles={vehiclesQuery.data?.items ?? []}
      zones={zones}
      perMinutePlan={perMinutePlan}
      unlocking={startRide.isPending}
      unlockError={unlockError}
      onUnlock={(vehicle: Vehicle) => {
        if (perMinutePlan === null) return;
        startRide.mutate({ qrCode: vehicle.qrCode, planId: perMinutePlan.id });
      }}
      onClearUnlockError={() => setUnlockError(null)}
      onRefresh={() => {
        void vehiclesQuery.refetch();
        void zonesQuery.refetch();
      }}
      refreshing={vehiclesQuery.isRefetching || zonesQuery.isRefetching}
      loadError={vehiclesQuery.isError && vehiclesQuery.data === undefined}
    />
  );
}
