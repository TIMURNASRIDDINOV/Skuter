import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { DURATION, useMotion } from '@/lib/motion';
import { caps, colors, outline, shadows, spacing } from '@/lib/theme';

/**
 * Slide right to switch the scooter on, slide back to switch it off.
 *
 * A deliberate gesture rather than a tap: this control turns a real vehicle on
 * in the street, and the reference app it is modelled on makes you mean it. It
 * is also the one thing on the rental screen, so it can afford the room.
 *
 * The knob follows the finger optimistically and the *label* waits for the
 * server — a command that fails springs it home, which is the same contract as
 * the 8% unlock failure on the per-minute path.
 */

const KNOB = 60;
const PAD = 5;
const TRACK_HEIGHT = KNOB + PAD * 2;
/** Fraction of the travel that commits the gesture. */
const COMMIT = 0.55;

export function SlideToLock({
  unlocked,
  pending,
  onChange,
}: {
  unlocked: boolean;
  pending: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const { duration } = useMotion();

  // Resolved on the JS thread, captured by the gesture worklets as a plain
  // number. `duration()` is an ordinary closure from `useMotion`, and calling
  // one *inside* a worklet crashes the app on the UI thread — the gesture
  // callbacks below are worklets, so nothing in them may call back into JS
  // except through `runOnJS`.
  const settleMs = duration(DURATION.base);

  const width = useSharedValue(0);
  // 0 = knob at the locked end, 1 = at the unlocked end.
  const progress = useSharedValue(unlocked ? 1 : 0);
  const dragging = useSharedValue(false);

  // The server is the authority: a rental that was switched on from another
  // device, or a command that failed, moves the knob without anybody touching
  // it. Skipped mid-drag so it cannot fight the finger.
  useEffect(() => {
    if (dragging.value) return;
    progress.value = withSpring(unlocked ? 1 : 0, { damping: 18, stiffness: 180 });
  }, [unlocked, dragging, progress]);

  const commit = (next: boolean): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onChange(next);
  };

  const pan = Gesture.Pan()
    .enabled(!pending)
    .onBegin(() => {
      dragging.value = true;
    })
    .onUpdate((event) => {
      const travel = Math.max(1, width.value - KNOB - PAD * 2);
      const from = unlocked ? travel : 0;
      progress.value = Math.min(1, Math.max(0, (from + event.translationX) / travel));
    })
    .onEnd(() => {
      dragging.value = false;
      const target = unlocked ? progress.value < 1 - COMMIT : progress.value > COMMIT;
      if (target === unlocked) {
        // Did not travel far enough — go back where it came from.
        progress.value = withSpring(unlocked ? 1 : 0, { damping: 18, stiffness: 180 });
        return;
      }
      progress.value = withTiming(unlocked ? 0 : 1, { duration: settleMs });
      runOnJS(commit)(!unlocked);
    })
    .onFinalize(() => {
      dragging.value = false;
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * Math.max(1, width.value - KNOB - PAD * 2) }],
  }));

  // The volt fill grows behind the knob, so the track fills as the scooter
  // comes on rather than merely reporting that it did.
  const fillStyle = useAnimatedStyle(() => ({
    width: PAD + KNOB / 2 + progress.value * Math.max(1, width.value - KNOB - PAD * 2),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.35, 0.65, 1], [1, 0.15, 0.15, 1]),
  }));

  return (
    <View
      style={styles.track}
      onLayout={(event: LayoutChangeEvent) => {
        width.value = event.nativeEvent.layout.width;
      }}
    >
      <Animated.View style={[styles.fill, fillStyle]} pointerEvents="none" />

      <Animated.Text
        style={[styles.label, unlocked && styles.labelOn, labelStyle]}
        numberOfLines={1}
        pointerEvents="none"
      >
        {pending ? t.rentalWorking : unlocked ? t.rentalSlideToLock : t.rentalSlideToUnlock}
      </Animated.Text>

      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityRole="switch"
          accessibilityState={{ checked: unlocked, disabled: pending }}
          accessibilityLabel={unlocked ? t.rentalSlideToLock : t.rentalSlideToUnlock}
          testID="rental-slider"
          style={[styles.knob, knobStyle]}
        >
          <Icon
            name={unlocked ? 'bolt' : 'lock'}
            size={24}
            color={unlocked ? colors.onPrimary : colors.text}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    overflow: 'hidden',
    ...outline,
    ...shadows.md,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.primary,
  },
  label: {
    ...caps,
    fontSize: 13,
    letterSpacing: 0.6,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingLeft: KNOB,
    paddingRight: spacing.l,
  },
  labelOn: { color: colors.text },
  knob: {
    position: 'absolute',
    left: PAD,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...outline,
    ...shadows.sm,
  },
});
