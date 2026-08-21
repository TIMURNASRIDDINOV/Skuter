import type {
  ActiveRide,
  CommandResult,
  ParkingCheck,
  Plan,
  Ride,
  RideReceipt,
  SubscriptionDetail,
  UserProfile,
  Vehicle,
  Zone,
} from '@ozothunder/shared';
import { SIMULATOR_TICK_MS } from '@ozothunder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ListResponse } from './api';
import { ApiRequestError, apiFetch, clearToken, hasToken, registerUnauthorizedHandler } from './api';
import { ManualCodeSheet } from './components/ManualCodeSheet';
import { SectionTabs, type Section } from './components/SectionTabs';
import { TabBar, type Tab } from './components/TabBar';
import { Login } from './screens/Login';
import { MapScreen } from './screens/MapScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ReceiptScreen } from './screens/ReceiptScreen';
import { RentScreen } from './screens/RentScreen';
import { RideScreen } from './screens/RideScreen';
import { canScanQr, haptic, scanQr } from './telegram';

export function App() {
  const [authed, setAuthed] = useState(hasToken());
  const [tab, setTab] = useState<Tab>('map');
  const [section, setSection] = useState<Section>('general');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<RideReceipt | null>(null);
  const [blocked, setBlocked] = useState<ParkingCheck | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [beepNote, setBeepNote] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  /** Set while the scan flow is buying a pass rather than starting a ride. */
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [rentNotice, setRentNotice] = useState<string | null>(null);
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
  const subscriptionsQuery = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => apiFetch<ListResponse<SubscriptionDetail>>('/subscriptions'),
    enabled: authed,
  });
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<UserProfile>('/me'),
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
      void queryClient.invalidateQueries({ queryKey: ['me'] });
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

  const buySubscription = useMutation({
    mutationFn: (body: { planId: string; vehicleId: string }) =>
      apiFetch<{ subscription: unknown }>('/subscriptions', { method: 'POST', body }),
    onSuccess: () => {
      haptic('success');
      setRentNotice('Абонемент оформлен — самокат закреплён за вами');
      setTimeout(() => setRentNotice(null), 5000);
      void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) => {
      haptic('error');
      setRentNotice(
        error instanceof ApiRequestError ? error.message : 'Не удалось оформить абонемент',
      );
      setTimeout(() => setRentNotice(null), 5000);
    },
  });

  const vehicles = vehiclesQuery.data?.items ?? [];

  /** A scanned or typed code lands here from either entry point. */
  const resolveCode = (raw: string): boolean => {
    const match = raw.match(/\d{9}/);
    const vehicle = match === null ? undefined : vehicles.find((v) => v.qrCode === match[0]);
    if (vehicle === undefined) {
      haptic('error');
      setManualError('Самокат не найден — проверьте код');
      setManualOpen(true);
      return false;
    }
    setManualOpen(false);
    setManualError(null);
    if (pendingPlan !== null) {
      buySubscription.mutate({ planId: pendingPlan.id, vehicleId: vehicle.id });
      setPendingPlan(null);
      setTab('map');
      setSection('rent');
      return true;
    }
    setTab('map');
    setSection('general');
    setSelectedId(vehicle.id);
    return true;
  };

  /** Central scan button: Telegram's native QR popup, manual-entry fallback. */
  const openScan = (plan: Plan | null = null) => {
    setPendingPlan(plan);
    setManualError(null);
    if (canScanQr()) {
      void scanQr('Наведите камеру на QR-код самоката').then((text) => {
        if (text !== null && resolveCode(text)) return;
        if (text === null) setManualOpen(true);
      });
    } else {
      setManualOpen(true);
    }
  };

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
    <div className="shell">
      {tab === 'map' && <SectionTabs section={section} onSection={setSection} />}

      <div className="tab-content">
        <div
          className={tab === 'map' && section === 'general' ? 'tab-panel' : 'tab-panel hidden'}
        >
          <MapScreen
            vehicles={vehicles}
            zones={zones}
            perMinutePlan={perMinutePlan}
            selectedId={selectedId}
            onSelect={setSelectedId}
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
        </div>
        <div className={tab === 'map' && section === 'rent' ? 'tab-panel' : 'tab-panel hidden'}>
          <RentScreen
            plans={plans}
            subscriptions={subscriptionsQuery.data?.items ?? []}
            loading={subscriptionsQuery.isLoading}
            buying={buySubscription.isPending}
            notice={rentNotice}
            onBuy={(plan) => openScan(plan)}
          />
        </div>
        <div className={tab === 'profile' ? 'tab-panel' : 'tab-panel hidden'}>
          <ProfileScreen
            user={meQuery.data ?? null}
            onLogout={() => {
              clearToken();
              setAuthed(false);
            }}
          />
        </div>
      </div>

      <TabBar tab={tab} onTab={setTab} onScan={() => openScan(null)} />

      <ManualCodeSheet
        open={manualOpen}
        error={manualError}
        onSubmit={resolveCode}
        onClose={() => {
          setManualOpen(false);
          setManualError(null);
          setPendingPlan(null);
        }}
      />
    </div>
  );
}
