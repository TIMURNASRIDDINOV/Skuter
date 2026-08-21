import type { RiderSession, UserProfile } from '@ozothunder/shared';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  apiFetch,
  clearToken,
  loadStoredToken,
  registerUnauthorizedHandler,
  setToken,
  userStorage,
} from '@/api/client';

type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionContextValue {
  status: SessionStatus;
  user: UserProfile | null;
  signIn: (session: RiderSession) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: UserProfile) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUserState] = useState<UserProfile | null>(null);

  const signOut = useCallback(async () => {
    await clearToken();
    setUserState(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      void signOut();
    });

    void (async () => {
      const token = await loadStoredToken();
      if (token === null) {
        setStatus('signedOut');
        return;
      }
      const cached = await userStorage.load();
      if (cached !== null) setUserState(JSON.parse(cached) as UserProfile);
      setStatus('signedIn');
      // Refresh the profile in the background; a dead token signs us out
      // through the unauthorized handler.
      try {
        const fresh = await apiFetch<UserProfile>('/me');
        setUserState(fresh);
        await userStorage.save(JSON.stringify(fresh));
      } catch {
        // Network failure is fine — the cached profile carries the screen.
      }
    })();
  }, [signOut]);

  const signIn = useCallback(async (session: RiderSession) => {
    await setToken(session.token);
    await userStorage.save(JSON.stringify(session.user));
    setUserState(session.user);
    setStatus('signedIn');
  }, []);

  const setUser = useCallback((next: UserProfile) => {
    setUserState(next);
    void userStorage.save(JSON.stringify(next));
  }, []);

  return (
    <SessionContext.Provider value={{ status, user, signIn, signOut, setUser }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
