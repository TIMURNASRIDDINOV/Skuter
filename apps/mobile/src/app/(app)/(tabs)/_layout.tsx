import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { colors, typography } from '@/lib/theme';

/**
 * Bottom navigation: Карта / Профиль.
 *
 * **Scanning is not a tab.** It used to be a raised button in a central third
 * slot, which stopped making sense once the map sheet grew its own scan
 * control: both sat on the same screen, three centimetres apart, doing the
 * same thing. The sheet's is the one that survived — it is far larger, it sits
 * where a thumb already rests, and it is beside the scooter cards it acts on.
 *
 * The bar owns the bottom inset, which is what keeps every screen clear of
 * Android's edge-to-edge gesture bar.
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
