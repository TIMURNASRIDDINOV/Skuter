import BottomSheet, { BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import { qrCodeSchema } from '@scoot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Vehicle } from '@scoot/shared';
import { queryKeys } from '@/api/queries';
import type { ListResponse } from '@/api/client';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui';
import { DEMO_CONTROLS_ENABLED } from '@/lib/demo';
import { useI18n } from '@/lib/i18n';
import { colors, radius, spacing, typography } from '@/lib/theme';

/** With no successful read after this long, suggest typing the code. */
const SCAN_TROUBLE_MS = 6000;

export default function ScanScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [trouble, setTrouble] = useState(false);
  const [digits, setDigits] = useState('');
  const handled = useRef(false);
  const sheetRef = useRef<BottomSheet>(null);
  const manualSnapPoints = useMemo(() => ['42%'], []);

  useEffect(() => {
    const timer = setTimeout(() => setTrouble(true), SCAN_TROUBLE_MS);
    return () => clearTimeout(timer);
  }, []);

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

  const submitManual = () => {
    const parsed = qrCodeSchema.safeParse(`SCOOT-${digits}`);
    if (parsed.success) proceed(parsed.data);
  };

  // There are no physical stickers — demo step 2's dev button picks a real
  // seeded vehicle so the rest of the flow is exercised end to end.
  const simulateScan = () => {
    const cached = queryClient.getQueryData<ListResponse<Vehicle>>(queryKeys.vehicles);
    const candidate = cached?.items.find((vehicle) => vehicle.status === 'available');
    if (candidate !== undefined) proceed(candidate.qrCode);
  };

  const manualSheet = (
    <BottomSheet
      ref={sheetRef}
      snapPoints={manualSnapPoints}
      index={-1}
      enablePanDownToClose
      enableDynamicSizing={false}
      keyboardBehavior="interactive"
      android_keyboardInputMode="adjustResize"
      handleIndicatorStyle={styles.sheetHandle}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={[styles.sheetContent, { paddingBottom: insets.bottom + spacing.l }]}>
        <Text style={styles.sheetTitle}>{t.manualCodeTitle}</Text>
        <Text style={styles.sheetHint}>{t.manualCodeHint}</Text>
        <View style={styles.codeRow}>
          <Text style={styles.codePrefix}>SCOOT-</Text>
          <BottomSheetTextInput
            style={styles.codeInput}
            value={digits}
            onChangeText={(text) => setDigits(text.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            placeholder="0042"
            placeholderTextColor={colors.textSecondary}
            maxLength={4}
            testID="manual-code-input"
          />
        </View>
        <Button
          label={t.manualCodeSubmit}
          onPress={submitManual}
          disabled={!/^\d{4}$/.test(digits)}
        />
      </BottomSheetView>
    </BottomSheet>
  );

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.denied}>
        <CloseButton onPress={() => router.back()} dark />
        <EmptyState emoji="📷" title={t.cameraDenied} hint={t.cameraDeniedHint} />
        <View style={styles.deniedActions}>
          <Button label={t.grantCamera} onPress={() => void requestPermission()} />
          <Button
            label={t.enterCodeManually}
            variant="secondary"
            onPress={() => sheetRef.current?.snapToIndex(0)}
          />
          {DEMO_CONTROLS_ENABLED && (
            <Button label={t.simulateScan} onPress={simulateScan} variant="ghost" />
          )}
        </View>
        {manualSheet}
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
        onMountError={() => sheetRef.current?.snapToIndex(0)}
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
          {!invalid && (
            <Text style={styles.hintBody}>{trouble ? t.scanTrouble : t.scanHint}</Text>
          )}
        </View>

        <View style={styles.bottomRow}>
          <Pressable
            style={styles.manualButton}
            onPress={() => sheetRef.current?.snapToIndex(0)}
            testID="manual-entry"
          >
            <Text style={styles.manualButtonLabel}>{t.enterCodeManually}</Text>
          </Pressable>
          {DEMO_CONTROLS_ENABLED && (
            <Pressable style={styles.devButton} onPress={simulateScan} testID="simulate-scan">
              <Text style={styles.devButtonLabel}>{t.simulateScan}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      {manualSheet}
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
  bottomRow: { alignItems: 'center', gap: spacing.m, minHeight: 52 },
  manualButton: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.m,
  },
  manualButtonLabel: { ...typography.label, color: '#FFF' },
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
  sheetHandle: { backgroundColor: colors.border, width: 44 },
  sheetBackground: { backgroundColor: colors.surface, borderRadius: radius.xl },
  sheetContent: {
    padding: spacing.l,
    gap: spacing.m,
    alignItems: 'stretch',
  },
  sheetTitle: { ...typography.heading, color: colors.text, textAlign: 'center' },
  sheetHint: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
  },
  codePrefix: { ...typography.title, color: colors.textSecondary, letterSpacing: 1 },
  codeInput: {
    ...typography.title,
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
    minWidth: 120,
    letterSpacing: 4,
    textAlign: 'center',
  },
});
