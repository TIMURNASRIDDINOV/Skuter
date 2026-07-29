import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/lib/i18n';
import { colors, spacing, typography } from '@/lib/theme';

/**
 * Uzum-style bottom navigation: Карта / Аренда / raised circular Скан /
 * Профиль. The scan slot is not a tab — its button pushes the full-screen
 * scanner modal. The bar owns the bottom inset, which is what keeps every
 * screen clear of Android's edge-to-edge gesture bar.
 */
export default function TabsLayout() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryPressed,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { ...typography.caption, fontWeight: '600' },
        tabBarStyle: {
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 6,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.tabMap,
          tabBarIcon: ({ focused }) => <TabGlyph glyph="🗺" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="rental"
        options={{
          title: t.tabRental,
          tabBarIcon: ({ focused }) => <TabGlyph glyph="🎟" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="scan-action"
        options={{
          title: t.tabScan,
          tabBarButton: () => <ScanTabButton />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t.tabProfile,
          tabBarIcon: ({ focused }) => <TabGlyph glyph="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

function TabGlyph({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;
}

/** The raised centre button — pushes the scanner instead of switching tabs. */
function ScanTabButton() {
  const router = useRouter();
  return (
    <Pressable
      style={styles.scanButton}
      onPress={() => router.push('/scan')}
      testID="scan-button"
    >
      <Text style={styles.scanGlyph}>▣</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scanButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -spacing.xl,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  scanGlyph: { fontSize: 24, color: colors.textInverse },
});
