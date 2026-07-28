import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Button, Skeleton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { colors, spacing, typography } from '@/lib/theme';

/** Something went wrong + retry. Never a raw error string on white. */
export function ErrorState({
  onRetry,
  message,
  style,
}: {
  onRetry: () => void;
  message?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useI18n();
  return (
    <View style={[styles.centered, style]}>
      <Text style={styles.emoji}>⚠️</Text>
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
  style,
}: {
  title: string;
  hint?: string;
  emoji?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.centered, style]}>
      <Text style={styles.emoji}>{emoji}</Text>
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
  emoji: { fontSize: 40, marginBottom: spacing.s },
  title: { ...typography.heading, color: colors.text, textAlign: 'center' },
  hint: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  action: { marginTop: spacing.l, alignSelf: 'stretch' },
  skeletonList: { padding: spacing.l, gap: spacing.l },
  skeletonRow: { flexDirection: 'row', gap: spacing.m, alignItems: 'center' },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22 },
  skeletonLines: { flex: 1, gap: spacing.s },
  skeletonLineWide: { height: 14, width: '70%' },
  skeletonLineNarrow: { height: 12, width: '40%' },
});
