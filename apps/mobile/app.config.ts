import { config as loadEnv } from 'dotenv';
import * as path from 'node:path';
import type { ExpoConfig } from 'expo/config';

// Expo CLI auto-loads apps/mobile/.env. The root .env fills anything the
// app-local file does not set, so a single root .env serves the monorepo
// (dotenv never overrides variables that already exist).
loadEnv({ path: path.resolve(__dirname, '../../.env') });

/**
 * The iOS client id in reversed-DNS form, which is what Google's SDK registers
 * as a URL scheme. `123-abc.apps.googleusercontent.com` becomes
 * `com.googleusercontent.apps.123-abc`.
 *
 * The placeholder keeps `expo prebuild` working on a machine that has not been
 * given the client ids yet — the app simply does not offer Google sign-in,
 * which `googleSignInAvailable` in src/api/google.ts already handles.
 */
const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID;
const googleIosUrlScheme =
  iosClientId === undefined
    ? 'com.googleusercontent.apps.placeholder'
    : `com.googleusercontent.apps.${iosClientId.replace('.apps.googleusercontent.com', '')}`;

const config: ExpoConfig = {
  name: 'Scoot',
  slug: 'scoot',
  // Required for `eas build --non-interactive`, which cannot otherwise work
  // out which account owns the project.
  owner: 'temurnasriddinov',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'scoot',
  // The demo is designed against one palette; a half-designed dark theme
  // reads worse than none.
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'uz.scoot.rider',
    supportsTablet: false,
    config: {
      // No custom crypto — skips the App Store export-compliance prompt.
      usesNonExemptEncryption: false,
    },
    infoPlist: {
      // Test builds call the API over plain HTTP (a LAN IP or tunnel), which
      // release builds block by default. Remove for a store submission —
      // production would talk to an https endpoint anyway.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
    },
  },
  android: {
    package: 'uz.scoot.rider',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  plugins: [
    // MapLibre + OpenFreeMap tiles on both platforms — no API key anywhere.
    '@maplibre/maplibre-react-native',
    // Google sign-in. `iosUrlScheme` is the iOS client id with its dot-separated
    // parts reversed — Google's SDK requires it as a URL scheme so the sheet can
    // hand control back to the app. Derived below rather than pasted twice.
    [
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: googleIosUrlScheme },
    ],
    [
      'expo-build-properties',
      {
        // Same reason as NSAllowsArbitraryLoads above: test builds call the
        // API over plain HTTP, which Android 9+ blocks in release builds.
        // Remove for a store submission.
        android: { usesCleartextTraffic: true },
      },
    ],
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#10B981',
        image: './assets/images/splash-icon.png',
        imageWidth: 96,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Scoot использует камеру, чтобы сканировать QR-код на самокате.',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Scoot использует геопозицию, чтобы показывать самокаты рядом с вами.',
      },
    ],
    'expo-secure-store',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: 'b7f5e12e-d2ec-419c-8766-15ade9c0b40a',
    },
    // Read at runtime by src/api/google.ts. Client ids are public values — the
    // secret half of an OAuth client never reaches a mobile app.
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID,
  },
};

export default config;
