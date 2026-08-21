import type { RiderSession } from '@scoot/shared';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';
import { useCallback, useState } from 'react';
import { apiFetch } from '@/api/client';
import { useSession } from '@/api/session';

/**
 * "Continue with Google" for the native app. The Google SDK shows the system
 * sheet and hands back an ID token; the API verifies it against Google's
 * published keys and answers with a session, which goes into the same signIn
 * funnel the OTP and Telegram flows use.
 *
 * Same surface as `useTelegramLogin` — `start`, `waiting`, `failed` — so the
 * login screen treats the two the same way.
 */

const webClientId = Constants.expoConfig?.extra?.googleWebClientId as string | undefined;
const iosClientId = Constants.expoConfig?.extra?.googleIosClientId as string | undefined;

/** Configuration is module-level and synchronous, as the SDK requires. */
let configured = false;

function configure(): void {
  if (configured) return;
  GoogleSignin.configure({
    // The *web* client id is what the ID token's `aud` carries on Android, so
    // it has to be supplied even though nothing here is a web app.
    ...(webClientId === undefined ? {} : { webClientId }),
    ...(iosClientId === undefined ? {} : { iosClientId }),
  });
  configured = true;
}

/** Whether the build was given enough configuration to offer Google sign-in. */
export const googleSignInAvailable = webClientId !== undefined || iosClientId !== undefined;

export function useGoogleLogin() {
  const { signIn } = useSession();
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);

  const start = useCallback(async () => {
    setFailed(false);
    setWaiting(true);
    try {
      configure();
      // Android only; on iOS this resolves without doing anything.
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      const response = await GoogleSignin.signIn();
      // Backing out of the sheet is not a failure — leave the screen as it was.
      if (!isSuccessResponse(response)) return;

      const { idToken } = response.data;
      if (idToken === null || idToken === undefined) {
        setFailed(true);
        return;
      }

      const session = await apiFetch<RiderSession>('/auth/google', {
        method: 'POST',
        body: { idToken },
        anonymous: true,
      });
      await signIn(session);
    } catch {
      setFailed(true);
    } finally {
      setWaiting(false);
    }
  }, [signIn]);

  return { start, waiting, failed };
}
