import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { colors, shadows, spacing, typography } from '@/lib/theme';

/**
 * Bottom navigation: Карта / raised circular Скан / Профиль.
 *
 * **Three slots, not four.** The scan button is the primary action of the
 * whole app, so it has to sit dead centre — and with four slots it lands at
 * 62.5% of the width, visibly off. Rental moved out to its own screen, reached
 * from Профиль: it duplicated the subscriptions and history already there, and
 * its only unique content was the price list.
 *
 * The scan slot is not a tab — its button pushes the full-screen scanner
 * modal. The bar owns the bottom inset, which is what keeps every screen clear
 * of Android's edge-to-edge gesture bar.
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
          tabBarIcon: ({ color }) => <TabIcon name="map" color={color} />,
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
          tabBarIcon: ({ color }) => <TabIcon name="person" color={color} />,
        }}
      />
    </Tabs>
  );
}

/** Tabs hands tints over as ColorValue; the tab tints are plain hex strings. */
function TabIcon({ name, color }: { name: IconName; color: ColorValue }) {
  return <Icon name={name} size={22} color={color as string} />;
}

/** The raised centre button — pushes the scanner instead of switching tabs. */
function ScanTabButton() {
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.scanButton,
        { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
      ]}
      onPress={() => router.push('/scan')}
      testID="scan-button"
    >
      <Icon name="scan" size={26} color={colors.textInverse} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scanButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginTop: -spacing.xl,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
    ...shadows.lg,
  },
});
