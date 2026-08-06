import BottomSheet, { BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import { qrCodeSchema } from '@scoot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { ZoomIn } from 'react-native-reanimated';
import type { Vehicle } from '@scoot/shared';
import { queryKeys } from '@/api/queries';
import type { ListResponse } from '@/api/client';
import { Button, Icon, IconButton } from '@/components/ui';
import { DEMO_CONTROLS_ENABLED } from '@/lib/demo';
import { useI18n } from '@/lib/i18n';
import { DURATION, useMotion } from '@/lib/motion';
import { chrome, colors, radius, shadows, spacing, typography } from '@/lib/theme';

/** With no successful read after this long, suggest typing the code. */
const SCAN_TROUBLE_MS = 6000;

/** How long the confirmation tick holds before the unlock screen takes over. */
const SCAN_CONFIRM_MS = 420;

/** Screen-edge padding — matches the rest of the app's chrome. */
const EDGE = 20;

const VIEWFINDER_SIZE = 250;

export default function ScanScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Opened from Аренда to buy a pass rather than from the map to ride.
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [trouble, setTrouble] = useState(false);
  const [digits, setDigits] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { reduced } = useMotion();
  const handled = useRef(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    },
    [],
  );

  const sheetRef = useRef<BottomSheet>(null);
  const manualSnapPoints = useMemo(() => ['42%'], []);

  useEffect(() => {
    const timer = setTimeout(() => setTrouble(true), SCAN_TROUBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Confirm the read before leaving the screen.
   *
   * Navigating straight off the scanner left a beat where the code had been
   * read but nothing on screen said so — the camera simply vanished. The
   * viewfinder now snaps to a filled tick for a moment first, so the scan
   * visibly registers before the unlock screen takes over. Under reduced
   * motion the pause collapses and the transition is immediate.
   */
  const proceed = (qrCode: string) => {
    if (handled.current) return;
    handled.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setConfirmed(true);

    const go = () => {
      router.replace(
        intent === 'subscribe'
          ? { pathname: '/plans', params: { qr: qrCode } }
          : { pathname: '/unlock', params: { qr: qrCode } },
      );
    };

    if (reduced) {
      go();
      return;
    }
    confirmTimer.current = setTimeout(go, SCAN_CONFIRM_MS);
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

  /**
   * Rendered over whichever variant of this screen is showing.
   *
   * The scan can be confirmed from three places — a camera read, a typed code,
   * and the dev button — and two of those are reachable when the camera is
   * unavailable, which is exactly the case on a simulator and on the demo
   * path. Putting the confirmation inside the viewfinder would have covered
   * only one of them and left the other two with the dead air this was meant
   * to remove.
   */
  const confirmOverlay = confirmed ? (
    <View style={styles.confirmOverlay} pointerEvents="none">
      <Animated.View
        entering={reduced ? undefined : ZoomIn.duration(DURATION.base)}
        style={styles.confirmBadge}
      >
        <Icon name="check" size={44} color={colors.textInverse} />
      </Animated.View>
      <Text style={styles.confirmLabel}>{t.scanConfirmed}</Text>
    </View>
  ) : null;

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
        {confirmOverlay}
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
        {/* The title sits above the frame, as it does in the reference app —
            the instruction is read before the camera is aimed, so it belongs
            at the top of the screen rather than under the viewfinder. */}
        <View style={styles.topRow}>
          <Text style={styles.scanHeading} numberOfLines={2}>
            {invalid ? t.scanInvalid : t.scanTitle}
          </Text>
        </View>

        <View style={styles.viewfinderArea}>
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.cornerTL, invalid && styles.cornerInvalid]} />
            <View style={[styles.corner, styles.cornerTR, invalid && styles.cornerInvalid]} />
            <View style={[styles.corner, styles.cornerBL, invalid && styles.cornerInvalid]} />
            <View style={[styles.corner, styles.cornerBR, invalid && styles.cornerInvalid]} />
          </View>
          {!invalid && (
            <Text style={styles.hintBody}>{trouble ? t.scanTrouble : t.scanHint}</Text>
          )}
        </View>

        {/* Close, enter-a-code, torch — the reference app's three controls, in
            that order, so the two circular ones frame the wide pill. */}
        <View style={styles.controls}>
          <IconButton
            name="close"
            onPress={() => router.back()}
            color={chrome.text}
            background={chrome.surface}
            accessibilityLabel={t.close}
          />
          <Pressable
            style={({ pressed }) => [styles.manualButton, pressed && { opacity: 0.85 }]}
            onPress={() => sheetRef.current?.snapToIndex(0)}
            testID="manual-entry"
          >
            <Icon name="keypad" size={18} color={chrome.text} />
            <Text style={styles.manualButtonLabel}>{t.enterCodeManually}</Text>
          </Pressable>
          <IconButton
            name="flash"
            onPress={() => setTorch((on) => !on)}
            color={torch ? colors.text : chrome.text}
            background={torch ? colors.warning : chrome.surface}
            accessibilityLabel={t.torch}
          />
        </View>

        {DEMO_CONTROLS_ENABLED && (
          <Pressable style={styles.devButton} onPress={simulateScan} testID="simulate-scan">
            <Text style={styles.devButtonLabel}>{t.simulateScan}</Text>
          </Pressable>
        )}
      </SafeAreaView>

      {manualSheet}
      {confirmOverlay}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: EDGE },
  topRow: { paddingTop: spacing.l, paddingHorizontal: spacing.s },
  scanHeading: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: chrome.text,
    textAlign: 'center',
  },
  viewfinderArea: { alignItems: 'center', gap: spacing.l },
  confirmOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.l,
    backgroundColor: 'rgba(11, 15, 20, 0.55)',
  },
  confirmBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLabel: { ...typography.heading, color: colors.textInverse },
  viewfinder: { width: VIEWFINDER_SIZE, height: VIEWFINDER_SIZE },
  // Longer arms and a wider radius than the old 26/3/14 — the reference
  // frame reads as a bracket around the code rather than a hairline crop mark.
  corner: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderColor: colors.textInverse,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: radius.xl,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: radius.xl,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: radius.xl,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 5,
    borderRightWidth: 5,
    borderBottomRightRadius: radius.xl,
  },
  cornerInvalid: { borderColor: colors.warning },
  hintBody: { ...typography.body, color: chrome.textSecondary, textAlign: 'center' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.m,
    minHeight: 52,
  },
  manualButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    backgroundColor: chrome.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.l,
    height: 44,
    ...shadows.md,
  },
  manualButtonLabel: { ...typography.label, color: chrome.text },
  devButton: {
    alignSelf: 'center',
    marginTop: spacing.m,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.s,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderStyle: 'dashed',
  },
  devButtonLabel: { ...typography.label, color: chrome.textSecondary },
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
