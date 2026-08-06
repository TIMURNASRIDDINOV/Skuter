import type { Zone, ZoneKind } from '@scoot/shared';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Icon, type IconName } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { Strings } from '@/lib/i18n';
import { colors, numeric, radius, spacing, typography, ZONE_KIND_COLOUR } from '@/lib/theme';

interface ZoneMeta {
  icon: IconName;
  title: string;
  body: string;
}

export function zoneMeta(kind: ZoneKind, t: Strings): ZoneMeta {
  switch (kind) {
    case 'parking':
      return { icon: 'parking', title: t.zoneParkingTitle, body: t.zoneParkingBody };
    case 'forbidden':
      return { icon: 'block', title: t.zoneForbiddenTitle, body: t.zoneForbiddenBody };
    case 'slow':
      return { icon: 'speed', title: t.zoneSlowTitle, body: t.zoneSlowBody };
    case 'service':
      return { icon: 'layers', title: t.zoneServiceTitle, body: t.zoneServiceBody };
  }
}

/**
 * What a tapped zone means, in one card.
 *
 * The map has drawn these polygons since Checkpoint 3 and never explained
 * them: colour alone taught nobody what an orange shape does. Tapping one now
 * answers it in the rider's language, and a speed zone leads with its actual
 * number — a limit is only useful if you know what it is.
 */
export function ZoneSheet({
  zone,
  onDismiss,
  onMore,
}: {
  zone: Zone;
  onDismiss: () => void;
  onMore: () => void;
}) {
  const { t } = useI18n();
  const meta = zoneMeta(zone.kind, t);
  const colour = ZONE_KIND_COLOUR[zone.kind];
  const limit = zone.kind === 'slow' ? zone.speedLimitKph : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {limit === null ? (
          <View style={[styles.badge, { backgroundColor: `${colour}1F` }]}>
            <Icon name={meta.icon} size={26} color={colour} />
          </View>
        ) : (
          // The road-sign disc, at the size the reference app gives it: the
          // number is the headline, not decoration beside one.
          <View style={[styles.limitBadge, { borderColor: colour }]}>
            <Text style={styles.limitValue}>{limit}</Text>
          </View>
        )}
        <View style={styles.heading}>
          <Text style={styles.title}>
            {meta.title}
            {limit !== null && ` ${String(limit)} ${t.zoneSpeedLimit}`}
          </Text>
          <Text style={styles.zoneName} numberOfLines={1}>
            {zone.name}
          </Text>
        </View>
      </View>

      <Text style={styles.body}>{meta.body}</Text>

      <View style={styles.divider} />

      <Button label={t.moreAboutZones} variant="ghost" onPress={onMore} style={styles.moreButton} />
      <Button label={t.gotIt} onPress={onDismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: spacing.xl, gap: spacing.l },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.l },
  heading: { flex: 1, gap: 2 },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 5,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitValue: { fontSize: 22, fontWeight: '800', color: colors.text, ...numeric },
  title: { ...typography.title, color: colors.text },
  zoneName: { ...typography.label, color: colors.textSecondary },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 21 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  moreButton: { minHeight: 44, borderRadius: radius.m },
});
