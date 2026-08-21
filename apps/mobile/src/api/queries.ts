import type {
  ActiveRide,
  CommandResult,
  EndRideRequest,
  Plan,
  Ride,
  RideReceipt,
  StartRideRequest,
  Subscription,
  SubscriptionDetail,
  UserProfile,
  Vehicle,
  Zone,
} from '@ozothunder/shared';
import { SIMULATOR_TICK_MS } from '@ozothunder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import type { ListResponse } from '@/api/client';

export const queryKeys = {
  vehicles: ['vehicles'] as const,
  zones: ['zones'] as const,
  plans: ['plans'] as const,
  activeRide: ['activeRide'] as const,
  rides: ['rides'] as const,
  receipt: (rideId: string) => ['receipt', rideId] as const,
  subscriptions: ['subscriptions'] as const,
  reservation: ['reservation'] as const,
  profile: ['profile'] as const,
};

/** Riders have no SSE stream — the map stays fresh by polling. */
export function useVehicles() {
  return useQuery({
    queryKey: queryKeys.vehicles,
    queryFn: () => apiFetch<ListResponse<Vehicle>>('/vehicles'),
    refetchInterval: 5000,
  });
}

export function useZones() {
  return useQuery({
    queryKey: queryKeys.zones,
    queryFn: () => apiFetch<ListResponse<Zone>>('/catalog/zones'),
    staleTime: 60_000,
  });
}

export function usePlans() {
  return useQuery({
    queryKey: queryKeys.plans,
    queryFn: () => apiFetch<ListResponse<Plan>>('/catalog/plans'),
    staleTime: 5 * 60_000,
  });
}

export function useActiveRide(enabled = true) {
  return useQuery({
    queryKey: queryKeys.activeRide,
    queryFn: () => apiFetch<{ ride: ActiveRide | null }>('/rides/active'),
    refetchInterval: SIMULATOR_TICK_MS,
    enabled,
  });
}

export function useRideHistory() {
  return useQuery({
    queryKey: queryKeys.rides,
    queryFn: () => apiFetch<ListResponse<Ride>>('/rides'),
  });
}

export function useReceipt(rideId: string) {
  return useQuery({
    queryKey: queryKeys.receipt(rideId),
    queryFn: () => apiFetch<RideReceipt>(`/rides/${rideId}/receipt`),
    staleTime: Infinity,
  });
}

export function useSubscriptions() {
  return useQuery({
    queryKey: queryKeys.subscriptions,
    queryFn: () => apiFetch<ListResponse<SubscriptionDetail>>('/subscriptions'),
  });
}

export function useStartRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StartRideRequest) =>
      apiFetch<{ ride: Ride; unlockLatencyMs: number }>('/rides', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activeRide });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles });
    },
  });
}

export function useEndRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rideId, ...body }: EndRideRequest & { rideId: string }) =>
      apiFetch<RideReceipt>(`/rides/${rideId}/end`, { method: 'POST', body }),
    onSuccess: (receipt) => {
      queryClient.setQueryData(queryKeys.receipt(receipt.ride.id), receipt);
      void queryClient.invalidateQueries({ queryKey: queryKeys.activeRide });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles });
      void queryClient.invalidateQueries({ queryKey: queryKeys.rides });
    },
  });
}

export function useBeep() {
  return useMutation({
    mutationFn: (rideId: string) =>
      apiFetch<CommandResult>(`/rides/${rideId}/beep`, { method: 'POST' }),
  });
}

export function useBuySubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { planId: string; vehicleId: string }) =>
      apiFetch<{ subscription: Subscription }>('/subscriptions', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles });
    },
  });
}

/**
 * The rider's live hold, polled alongside the fleet.
 *
 * A hold can lapse without the rider touching anything, so the countdown
 * banner cannot be driven from the mutation's return value alone — it has to
 * keep asking. Same 5 s cadence as the map, which is where the banner sits.
 */
export function useReservation() {
  return useQuery({
    queryKey: queryKeys.reservation,
    queryFn: () =>
      apiFetch<{ reservation: { vehicle: Vehicle; until: string } | null }>(
        '/vehicles/reservation',
      ),
    refetchInterval: 5000,
  });
}

export function useReserveVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: string) =>
      apiFetch<Vehicle>(`/vehicles/${vehicleId}/reserve`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reservation });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles });
    },
  });
}

export function useReleaseVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: string) =>
      apiFetch<null>(`/vehicles/${vehicleId}/reserve`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reservation });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles });
    },
  });
}

/**
 * The rider's own profile. `SessionProvider` holds a copy from sign-in, but
 * the balance moves as rides are paid for — the map's balance chip reads this
 * so it does not show a figure from whenever the app last launched.
 */
export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => apiFetch<UserProfile>('/me'),
    staleTime: 30_000,
  });
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (body: { name: string | null }) =>
      apiFetch<UserProfile>('/me', { method: 'PATCH', body }),
  });
}
