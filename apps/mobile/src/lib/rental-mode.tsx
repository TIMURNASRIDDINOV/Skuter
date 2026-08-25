import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Which of the app's two faces the rider is looking at.
 *
 * `map` is the ordinary app — the fleet map, per-minute rides, zones, the OZO
 * wordmark. `rental` is what a weekly agreement turns it into: one rented
 * scooter, on and off, and the date the rental ends. Nothing else.
 *
 * The choice is persisted, so a rider on a weekly agreement opens the app into
 * their rental rather than into a map they have no use for that week. It is
 * only ever *acted* on while a rental actually exists — `map` is the fallback
 * everywhere else, which is what makes the wordmark come back by itself when
 * the office ends the rental.
 *
 * Same shape and same storage as `lib/i18n.tsx`; there is no reason for two
 * persisted-preference patterns in one app.
 */

export type RentalMode = 'map' | 'rental';

const MODE_KEY = 'ozothunder.rentalMode';

interface RentalModeValue {
  mode: RentalMode;
  setMode: (next: RentalMode) => void;
  /** False until SecureStore has answered — see `app/(app)/index.tsx`. */
  ready: boolean;
}

const RentalModeContext = createContext<RentalModeValue>({
  mode: 'map',
  setMode: () => undefined,
  ready: false,
});

export function RentalModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<RentalMode>('map');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await SecureStore.getItemAsync(MODE_KEY);
      if (cancelled) return;
      if (stored === 'rental') setModeState('rental');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: RentalMode) => {
    setModeState(next);
    void SecureStore.setItemAsync(MODE_KEY, next);
  }, []);

  return (
    <RentalModeContext.Provider value={{ mode, setMode, ready }}>
      {children}
    </RentalModeContext.Provider>
  );
}

export function useRentalMode(): RentalModeValue {
  return useContext(RentalModeContext);
}
