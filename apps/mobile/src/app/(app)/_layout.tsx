import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* The map is the app. Everything else is pushed on top of it from the
          menu sheet — there is no tab bar and no second root. */}
      <Stack.Screen name="index" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="rent" />
      <Stack.Screen name="history" />
      <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="unlock" />
      {/* An active ride cannot be swiped away — it ends in a parking zone. */}
      <Stack.Screen name="ride" options={{ gestureEnabled: false }} />
      <Stack.Screen name="receipt" options={{ gestureEnabled: false }} />
      <Stack.Screen name="plans" />
      <Stack.Screen name="rules" />
    </Stack>
  );
}
