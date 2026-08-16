import type { ZoneKind } from '@scoot/shared';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useZones } from '@/api/queries';
import { Icon, IconButton } from '@/components/ui';
import { zoneMeta } from '@/components/ZoneSheet';
import { useI18n } from '@/lib/i18n';
import {
  caps,
  colors,
  numeric,
  outline,
  radius,
  shadows,
  spacing,
  typography,
  ZONE_KIND_COLOUR,
} from '@/lib/theme';

/** Service area last: it is the outer boundary, not a thing you ride into. */
const KIND_ORDER: readonly ZoneKind[] = ['parking', 'slow', 'forbidden', 'service'];

/**
 * What the coloured shapes on the map mean.
 *
 * Reached from a zone's sheet («Подробнее о зонах») and from the map menu.
 * The map has drawn these polygons since Checkpoint 3 with nothing anywhere
 * explaining them — this is that explanation, and it reads the live zone list
 * so the speed limits shown are the ones actually in force rather than a
 * hardcoded example that drifts the first time an operator edits a zone.
 */
export default function RulesScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const zonesQuery = useZones();
  const zones = zonesQuery.data?.items ?? [];

  // Distinct limits actually in use, smallest first.
  const limits = [
    ...new Set(
      zones
        .filter((zone) => zone.kind === 'slow' && zone.speedLimitKph !== null)
        .map((zone) => zone.speedLimitKph as number),
    ),
  ].sort((a, b) => a - b);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <IconButton
          name="back"
          onPress={() => router.back()}
          size={40}
        />
        <View style={styles.headerText}>
          <Text style={styles.title}>{t.rulesTitle}</Text>
          <Text style={styles.subtitle}>{t.rulesSubtitle}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {KIND_ORDER.map((kind) => {
          const meta = zoneMeta(kind, t);
          const colour = ZONE_KIND_COLOUR[kind];
          const count = zones.filter((zone) => zone.kind === kind).length;

          return (
            <View key={kind} style={styles.card}>
              {/* The swatch is the point: it is the exact fill and stroke the
                  map draws, so the card teaches the legend rather than
                  describing it. */}
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: `${colour}26`, borderColor: colour },
                ]}
              >
                <Icon name={meta.icon} size={22} color={colour} />
              </View>

              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{meta.title}</Text>
                <Text style={styles.cardBodyText}>{meta.body}</Text>

                {kind === 'slow' && limits.length > 0 && (
                  <View style={styles.limits}>
                    {limits.map((kph) => (
                      <View key={kph} style={styles.limitBadge}>
                        <Text style={styles.limitValue}>{kph}</Text>
                      </View>
                    ))}
                    <Text style={styles.limitUnit}>{t.zoneSpeedLimit}</Text>
                  </View>
                )}

                {count > 0 && kind !== 'service' && (
                  <Text style={styles.count}>
                    {count} {t.onMapCount}
                  </Text>
                )}
              </View>
            </View>
          );
        })}

        <View style={styles.note}>
          <Icon name="info" size={16} color={colors.textSecondary} />
          <Text style={styles.noteText}>{t.rulesSpeedNote}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: 20,
    paddingTop: spacing.s,
    paddingBottom: spacing.l,
  },
  headerText: { flex: 1, gap: 2 },
  title: { ...typography.title, color: colors.text },
  subtitle: { fontSize: 12, ...caps, color: colors.textSecondary },
  content: { paddingHorizontal: 20, paddingBottom: spacing.xxl, gap: spacing.m },
  card: {
    flexDirection: 'row',
    gap: spacing.l,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    ...outline,
    ...shadows.sm,
  },
  swatch: {
    width: 52,
    height: 52,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    ...outline,
  },
  cardBody: { flex: 1, gap: spacing.xs },
  cardTitle: { ...typography.heading, color: colors.text },
  cardBodyText: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
  limits: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: spacing.xs },
  limitBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: ZONE_KIND_COLOUR.slow,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitValue: { fontSize: 13, fontWeight: '900', color: colors.text, ...numeric },
  limitUnit: { ...typography.caption, color: colors.textSecondary },
  count: { ...typography.caption, color: colors.textTertiary, marginTop: 2, ...numeric },
  note: {
    flexDirection: 'row',
    gap: spacing.s,
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.s,
  },
  noteText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 17 },
});
