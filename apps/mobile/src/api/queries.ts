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
} from '@scoot/shared';
import { SIMULATOR_TICK_MS } from '@scoot/shared';
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

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (body: { name: string | null }) =>
      apiFetch<UserProfile>('/me', { method: 'PATCH', body }),
  });
}
