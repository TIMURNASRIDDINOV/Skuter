import type { TelegramLoginPollResponse, TelegramLoginStartResponse } from '@scoot/shared';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiFetch } from '@/api/client';
import { useSession } from '@/api/session';

/**
 * "Continue with Telegram" for the native app. The API issues a one-time
 * nonce and a t.me deep link; the user taps Start in the bot; the bot's
 * webhook completes the nonce; we poll until it turns into a session and
 * feed it to the same signIn funnel the OTP flow uses.
 */
export function useTelegramLogin() {
  const { signIn } = useSession();
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
      const session = await apiFetch<TelegramLoginStartResponse>('/auth/telegram/start', {
        method: 'POST',
        anonymous: true,
      });

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
              await signIn({ token: result.token, user: result.user });
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
  }, [signIn]);

  return { start, cancel, waiting, failed };
}
