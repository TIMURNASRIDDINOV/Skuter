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
import { Button, Icon, IconButton } from '@/components/ui';
import { DEMO_CONTROLS_ENABLED } from '@/lib/demo';
import { useI18n } from '@/lib/i18n';
import { colors, radius, shadows, spacing, typography } from '@/lib/theme';

/** With no successful read after this long, suggest typing the code. */
const SCAN_TROUBLE_MS = 6000;

/** Screen-edge padding — matches the rest of the app's chrome. */
const EDGE = 20;

const VIEWFINDER_SIZE = 250;

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
        <View style={styles.deniedTop}>
          <IconButton name="close" onPress={() => router.back()} />
        </View>
        <View style={styles.deniedBody}>
          <View style={styles.deniedBadge}>
            <Icon name="scan" size={30} color={colors.textSecondary} />
          </View>
          <Text style={styles.deniedTitle}>{t.cameraDenied}</Text>
          <Text style={styles.deniedHint}>{t.cameraDeniedHint}</Text>
        </View>
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
          <IconButton
            name="close"
            onPress={() => router.back()}
            color={colors.textInverse}
            background="rgba(255,255,255,0.2)"
          />
          <IconButton
            name="flash"
            onPress={() => setTorch((on) => !on)}
            color={colors.textInverse}
            background={torch ? colors.warning : 'rgba(255,255,255,0.2)'}
          />
        </View>

        <View style={styles.viewfinderArea}>
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.cornerTL, invalid && styles.cornerInvalid]} />
            <View style={[styles.corner, styles.cornerTR, invalid && styles.cornerInvalid]} />
            <View style={[styles.corner, styles.cornerBL, invalid && styles.cornerInvalid]} />
            <View style={[styles.corner, styles.cornerBR, invalid && styles.cornerInvalid]} />
          </View>
          <Text style={styles.hintTitle}>{invalid ? t.scanInvalid : t.scanTitle}</Text>
          {!invalid && (
            <Text style={styles.hintBody}>{trouble ? t.scanTrouble : t.scanHint}</Text>
          )}
        </View>

        <View style={styles.bottomRow}>
          <Pressable
            style={({ pressed }) => [styles.manualButton, pressed && { opacity: 0.85 }]}
            onPress={() => sheetRef.current?.snapToIndex(0)}
            testID="manual-entry"
          >
            <Icon name="keypad" size={18} color={colors.text} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: EDGE },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.s,
  },
  viewfinderArea: { alignItems: 'center', gap: spacing.l },
  viewfinder: { width: VIEWFINDER_SIZE, height: VIEWFINDER_SIZE },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: colors.textInverse,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: radius.m,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: radius.m,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: radius.m,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: radius.m,
  },
  cornerInvalid: { borderColor: colors.warning },
  hintTitle: {
    ...typography.heading,
    color: colors.textInverse,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  hintBody: { ...typography.body, color: 'rgba(255,255,255,0.72)', textAlign: 'center' },
  bottomRow: { alignItems: 'center', gap: spacing.m, minHeight: 52 },
  manualButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.m,
    ...shadows.md,
  },
  manualButtonLabel: { ...typography.label, color: colors.text },
  devButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.m,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderStyle: 'dashed',
  },
  devButtonLabel: { ...typography.label, color: 'rgba(255,255,255,0.85)' },
  denied: { flex: 1, backgroundColor: colors.background, justifyContent: 'space-between' },
  deniedTop: {
    flexDirection: 'row',
    paddingHorizontal: EDGE,
    paddingTop: spacing.s,
  },
  deniedBody: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.s,
  },
  deniedBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.s,
  },
  deniedTitle: { ...typography.heading, color: colors.text, textAlign: 'center' },
  deniedHint: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  deniedActions: { padding: EDGE, gap: spacing.m },
  sheetHandle: { backgroundColor: colors.border, width: 44 },
  sheetBackground: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    ...shadows.lg,
  },
  sheetContent: {
    paddingHorizontal: EDGE,
    paddingTop: spacing.s,
    gap: spacing.l,
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
    fontVariant: ['tabular-nums'],
  },
});
