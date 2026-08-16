import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Button, Icon, Skeleton } from '@/components/ui';
import type { IconName } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { colors, outline, radius, spacing, typography } from '@/lib/theme';

/**
 * Leading glyph for empty/error states. When an icon name is given it renders
 * a native symbol in a 72dp muted circle; otherwise it falls back to the
 * legacy emoji string so existing call sites keep working.
 */
function StateGlyph({ icon, emoji }: { icon?: IconName; emoji: string }) {
  if (icon !== undefined) {
    return (
      <View style={styles.iconCircle}>
        <Icon name={icon} size={40} color={colors.text} />
      </View>
    );
  }
  return <Text style={styles.emoji}>{emoji}</Text>;
}

/** Something went wrong + retry. Never a raw error string on white. */
export function ErrorState({
  onRetry,
  message,
  icon = 'alert',
  style,
}: {
  onRetry: () => void;
  message?: string;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useI18n();
  return (
    <View style={[styles.centered, style]}>
      <StateGlyph icon={icon} emoji="⚠️" />
      <Text style={styles.title}>{message ?? t.loadingError}</Text>
      <Text style={styles.hint}>{t.offlineHint}</Text>
      <Button label={t.tryAgain} onPress={onRetry} variant="secondary" style={styles.action} />
    </View>
  );
}

export function EmptyState({
  title,
  hint,
  emoji = '🛴',
  icon,
  style,
}: {
  title: string;
  hint?: string;
  emoji?: string;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.centered, style]}>
      <StateGlyph icon={icon} emoji={emoji} />
      <Text style={styles.title}>{title}</Text>
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

/** Skeleton list rows — the loading state for every list screen. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Skeleton style={styles.skeletonAvatar} />
          <View style={styles.skeletonLines}>
            <Skeleton style={styles.skeletonLineWide} />
            <Skeleton style={styles.skeletonLineNarrow} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.s,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceBrand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.s,
    ...outline,
  },
  emoji: { fontSize: 40, marginBottom: spacing.s },
  title: { ...typography.heading, color: colors.text, textAlign: 'center' },
  hint: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  action: { marginTop: spacing.l, alignSelf: 'stretch' },
  skeletonList: { padding: spacing.l, gap: spacing.l },
  skeletonRow: { flexDirection: 'row', gap: spacing.m, alignItems: 'center' },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22 },
  skeletonLines: { flex: 1, gap: spacing.s },
  skeletonLineWide: { height: 14, width: '70%', borderRadius: radius.m },
  skeletonLineNarrow: { height: 12, width: '40%', borderRadius: radius.m },
});
