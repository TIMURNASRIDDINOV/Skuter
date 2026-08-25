import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { caps, colors, outline, outlineHair, radius, shadows, spacing } from '@/lib/theme';

/**
 * The switch between the app's two faces, in the spot the brand mark holds.
 *
 * It exists only while a weekly rental does. That placement is deliberate and
 * is the whole design: a rider without a rental sees the brand, exactly as
 * before, and a rider with one sees the way across to it in the first place
 * their eye lands. Nothing is added to the map, and nothing is taken away.
 */
export function ModeSwitch({
  target,
  onPress,
}: {
  /** Which face pressing this takes you to. */
  target: 'map' | 'rental';
  onPress: () => void;
}) {
  const { t } = useI18n();
  const toRental = target === 'rental';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={toRental ? t.switchToRental : t.switchToMap}
      testID="mode-switch"
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={({ pressed }) => [
        styles.pill,
        toRental && styles.pillRental,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.mark, toRental && styles.markRental]}>
        <Icon
          name={toRental ? 'ticket' : 'map'}
          size={16}
          color={toRental ? colors.onPrimary : colors.text}
        />
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {toRental ? t.switchToRental : t.switchToMap}
      </Text>
      <Icon name="chevronRight" size={12} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The same height as the brand mark it replaces, so swapping one for the
  // other does not shuffle the rest of the top row.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingLeft: 5,
    paddingRight: spacing.m,
    paddingVertical: 5,
    ...outline,
    ...shadows.md,
  },
  pillRental: { backgroundColor: colors.surfaceBrand },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    ...outlineHair,
  },
  markRental: { backgroundColor: colors.primary },
  label: { fontSize: 12, ...caps, letterSpacing: 0.6, color: colors.text },
  pressed: {
    transform: [{ translateY: 2 }],
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
});
