import { qrCodeSchema } from '@scoot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Vehicle } from '@scoot/shared';
import { queryKeys } from '@/api/queries';
import type { ListResponse } from '@/api/client';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui';
import { DEMO_CONTROLS_ENABLED } from '@/lib/demo';
import { useI18n } from '@/lib/i18n';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function ScanScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const handled = useRef(false);

  const proceed = (qrCode: string) => {
    if (handled.current) return;
    handled.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace({ pathname: '/unlock', params: { qr: qrCode } });
  };

  const onScanned = (data: string) => {
    if (handled.current || invalid) return;
    const parsed = qrCodeSchema.safeParse(data);
    if (parsed.success) {
      proceed(parsed.data);
    } else {
      // Foreign QR — flash a hint, then allow another attempt.
      setInvalid(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setTimeout(() => setInvalid(false), 1600);
    }
  };

  // There are no physical stickers — demo step 2's dev button picks a real
  // seeded vehicle so the rest of the flow is exercised end to end.
  const simulateScan = () => {
    const cached = queryClient.getQueryData<ListResponse<Vehicle>>(queryKeys.vehicles);
    const candidate = cached?.items.find((vehicle) => vehicle.status === 'available');
    if (candidate !== undefined) proceed(candidate.qrCode);
  };

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.denied}>
        <CloseButton onPress={() => router.back()} dark />
        <EmptyState emoji="📷" title={t.cameraDenied} hint={t.cameraDeniedHint} />
        <View style={styles.deniedActions}>
          <Button label={t.grantCamera} onPress={() => void requestPermission()} />
          {DEMO_CONTROLS_ENABLED && (
            <Button label={t.simulateScan} onPress={simulateScan} variant="secondary" />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => onScanned(data)}
      />

      <SafeAreaView style={styles.overlay}>
        <View style={styles.topRow}>
          <CloseButton onPress={() => router.back()} />
          <Pressable
            style={[styles.torchButton, torch && styles.torchOn]}
            onPress={() => setTorch((on) => !on)}
          >
            <Text style={styles.torchGlyph}>🔦</Text>
          </Pressable>
        </View>

        <View style={styles.viewfinderArea}>
          <View style={[styles.viewfinder, invalid && styles.viewfinderInvalid]} />
          <Text style={styles.hintTitle}>{invalid ? t.scanInvalid : t.scanTitle}</Text>
          {!invalid && <Text style={styles.hintBody}>{t.scanHint}</Text>}
        </View>

        <View style={styles.bottomRow}>
          {DEMO_CONTROLS_ENABLED && (
            <Pressable style={styles.devButton} onPress={simulateScan} testID="simulate-scan">
              <Text style={styles.devButtonLabel}>{t.simulateScan}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function CloseButton({ onPress, dark = false }: { onPress: () => void; dark?: boolean }) {
  return (
    <Pressable
      style={[styles.closeButton, dark && { backgroundColor: colors.surfaceMuted }]}
      onPress={onPress}
    >
      <Text style={[styles.closeGlyph, dark && { color: colors.text }]}>✕</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: spacing.l },
  topRow: { flexDirection: 'row', justifyContent: 'space-between' },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.s,
    marginTop: spacing.s,
  },
  closeGlyph: { fontSize: 16, color: '#FFF' },
  torchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.s,
    marginTop: spacing.s,
  },
  torchOn: { backgroundColor: colors.warning },
  torchGlyph: { fontSize: 18 },
  viewfinderArea: { alignItems: 'center', gap: spacing.l },
  viewfinder: {
    width: 240,
    height: 240,
    borderRadius: radius.xl,
    borderWidth: 3,
    borderColor: '#FFF',
    backgroundColor: 'transparent',
  },
  viewfinderInvalid: { borderColor: colors.warning },
  hintTitle: {
    ...typography.heading,
    color: '#FFF',
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  hintBody: { ...typography.body, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  bottomRow: { alignItems: 'center', minHeight: 52 },
  devButton: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.m,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderStyle: 'dashed',
  },
  devButtonLabel: { ...typography.label, color: '#FFF' },
  denied: { flex: 1, backgroundColor: colors.surface, justifyContent: 'space-between' },
  deniedActions: { padding: spacing.xl, gap: spacing.m },
});
