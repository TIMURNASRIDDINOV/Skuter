import type { TelegramLoginPollResponse, TelegramLoginStartResponse } from '@scoot/shared';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiFetch } from '@/api/client';
import { useSession } from '@/api/session';

/**
 * The Telegram flows for the native app. The API issues a one-time nonce and a
 * t.me deep link; the user taps Start in the bot; the bot asks them to share
 * their number; the webhook completes the nonce; we poll until it turns into a
 * session and feed it to the same signIn funnel the OTP flow uses.
 *
 * Two modes over one mechanism:
 *  - `login`  — signing in, and the shared number becomes the account's phone;
 *  - `link`   — already signed in (via Google), attaching a number.
 *
 * The rider shares their number rather than typing a code, so this path needs
 * no SMS provider at all — Telegram already verified the number and vouches
 * for it. See apps/api/src/routes/telegram-webhook.ts.
 */
export function useTelegramLogin(mode: 'login' | 'link' = 'login') {
  const { signIn, setUser } = useSession();
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const cancel = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setWaiting(false);
  }, []);

  const start = useCallback(async () => {
    setFailed(false);
    setWaiting(true);
    try {
      const session = await apiFetch<TelegramLoginStartResponse>(
        mode === 'link' ? '/me/phone/telegram/start' : '/auth/telegram/start',
        // Linking runs as the signed-in rider; login has no token yet.
        mode === 'link' ? { method: 'POST' } : { method: 'POST', anonymous: true },
      );

      await Linking.openURL(session.deepLink);

      await new Promise<void>((resolve, reject) => {
        let stopped = false;
        let polling = false;
        const deadline = Date.now() + session.expiresInS * 1000;

        const poll = async (): Promise<void> => {
          if (stopped || polling) return;
          polling = true;
          try {
            const result = await apiFetch<TelegramLoginPollResponse>(
              `/auth/telegram/poll?nonce=${encodeURIComponent(session.nonce)}`,
              { anonymous: true },
            );
            if (result.status === 'complete') {
              stop();
              if (mode === 'link') {
                // Already signed in — the session is for the same account, so
                // only the freshly-linked profile is worth taking.
                setUser(result.user);
              } else {
                await signIn({ token: result.token, user: result.user });
              }
              resolve();
            }
          } catch (error) {
            // 404 = expired or consumed; anything else is transient.
            stop();
            reject(error instanceof Error ? error : new Error('poll failed'));
          } finally {
            polling = false;
          }
        };

        const timer = setInterval(() => {
          if (Date.now() > deadline) {
            stop();
            reject(new Error('telegram login timed out'));
            return;
          }
          void poll();
        }, session.pollIntervalMs);

        // Returning from Telegram foregrounds the app — poll immediately.
        const appState = AppState.addEventListener('change', (state) => {
          if (state === 'active') void poll();
        });

        function stop(): void {
          stopped = true;
          clearInterval(timer);
          appState.remove();
        }

        stopRef.current = () => {
          stop();
          resolve();
        };
      });
    } catch {
      setFailed(true);
    } finally {
      stopRef.current = null;
      setWaiting(false);
    }
  }, [mode, signIn, setUser]);

  return { start, cancel, waiting, failed };
}
