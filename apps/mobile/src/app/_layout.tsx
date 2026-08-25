import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ApiRequestError } from '@/api/client';
import { SessionProvider, useSession } from '@/api/session';
import { LanguageProvider } from '@/lib/i18n';
import { RentalModeProvider } from '@/lib/rental-mode';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx responses are deliberate answers, not transient failures.
      retry: (failureCount, error) =>
        failureCount < 2 && (!(error instanceof ApiRequestError) || error.status >= 500),
    },
  },
});

function RootNavigator() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  // Keep the native splash up until we know whether a session exists —
  // flashing the login screen at a signed-in rider reads as a logout.
  if (status === 'loading') return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status !== 'signedIn'}>
        <Stack.Screen name="login" />
        <Stack.Screen name="verify" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <RentalModeProvider>
            <SessionProvider>
              <StatusBar style="dark" />
              <RootNavigator />
            </SessionProvider>
          </RentalModeProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
