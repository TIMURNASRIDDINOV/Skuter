import { config as loadEnv } from 'dotenv';
import * as path from 'node:path';
import type { ExpoConfig } from 'expo/config';

// Expo CLI auto-loads apps/mobile/.env. The root .env fills anything the
// app-local file does not set, so a single root .env serves the monorepo
// (dotenv never overrides variables that already exist).
loadEnv({ path: path.resolve(__dirname, '../../.env') });

const config: ExpoConfig = {
  name: 'Scoot',
  slug: 'scoot',
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
    config: {
      googleMaps: {
        // iOS uses Apple Maps and needs no key. Without this, Android map
        // tiles render grey while everything else still works (see README).
        apiKey: process.env.EXPO_PUBLIC_ANDROID_GOOGLE_MAPS_API_KEY,
      },
    },
  },
  plugins: [
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
  },
};

export default config;
