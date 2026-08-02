import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="unlock" />
      {/* An active ride cannot be swiped away — it ends in a parking zone. */}
      <Stack.Screen name="ride" options={{ gestureEnabled: false }} />
      <Stack.Screen name="receipt" options={{ gestureEnabled: false }} />
      <Stack.Screen name="plans" />
      <Stack.Screen name="rental" />
    </Stack>
  );
}
