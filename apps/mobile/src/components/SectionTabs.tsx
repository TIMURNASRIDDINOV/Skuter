import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useI18n } from '@/lib/i18n';
import { DURATION, EASE_OUT, useMotion } from '@/lib/motion';
import { colors, radius, shadows, spacing } from '@/lib/theme';

export type Section = 'general' | 'rent';

/**
 * Folder-style switcher pinned above the map: «Общий» is the shared
 * per-minute fleet, «Аренда» is the subscription passes.
 *
 * Ported from the mini app's `SectionTabs` so the two rider clients share an
 * information architecture — Аренда used to be buried behind Профиль here,
 * which is the one place the native app and the Telegram app disagreed about
 * what the product is. The active tab sits on `surface` and carries the map
 * below it; the inactive one sits back on `background`, which is what gives
 * the pair their folder-tab read.
 */
export function SectionTabs({
  section,
  onChange,
}: {
  section: Section;
  onChange: (section: Section) => void;
}) {
  const { t } = useI18n();

  return (
    <View style={styles.bar}>
      {(
        [
          ['general', t.sectionGeneral],
          ['rent', t.sectionRent],
        ] as const
      ).map(([value, label]) => {
        const active = section === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              void Haptics.selectionAsync();
              onChange(value);
            }}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One section's content. Every panel stays mounted for the life of the screen
 * — hiding is opacity and hit-testing only, never an unmount, because tearing
 * MapLibre down and back up on each switch costs a re-init and a re-tile.
 *
 * The incoming panel fades in *over* the outgoing one, which holds at full
 * opacity underneath until the fade lands. Fading both at once would cross
 * through two semi-transparent layers and flash the background between them.
 */
export function SectionPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const { duration } = useMotion();
  const opacity = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    const ms = duration(DURATION.fast);
    opacity.value = active
      ? withTiming(1, { duration: ms, easing: EASE_OUT })
      : // Hold, then drop out once whatever replaced it is fully opaque.
        withDelay(ms, withTiming(0, { duration: 0 }));
  }, [active, duration, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[styles.panel, active ? styles.panelFront : styles.panelBack, animatedStyle]}
      pointerEvents={active ? 'auto' : 'none'}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  panelFront: { zIndex: 1 },
  panelBack: { zIndex: 0 },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    paddingTop: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.m,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
  },
  tabActive: { backgroundColor: colors.surface, ...shadows.sm },
  // 16 → 17 on activation, matching the mini app. A wider delta (body →
  // heading) reflows the bar's height on every switch and reads as a jolt.
  label: { fontSize: 16, fontWeight: '500', letterSpacing: -0.2, color: colors.textSecondary },
  labelActive: { fontSize: 17, fontWeight: '800', color: colors.text },
});
