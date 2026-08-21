import type { RiderSession, UserProfile } from '@scoot/shared';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { ApiRequestError, apiFetch } from '@/api/client';
import { useSession } from '@/api/session';
import { IconButton } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { caps, colors, radius, shadows, spacing, typography } from '@/lib/theme';

const CODE_LENGTH = 6;

/** Signing in yields a session; linking yields the updated profile. */
type VerifyResult =
  | { kind: 'session'; session: RiderSession }
  | { kind: 'linked'; user: UserProfile };

export default function VerifyScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { signIn, setUser } = useSession();
  const params = useLocalSearchParams<{
    phone: string;
    retryAfterS?: string;
    devCode?: string;
    /** '1' when attaching a phone to an account that is already signed in. */
    link?: string;
  }>();
  const phone = params.phone ?? '';

  // The same six digits either sign you in or attach a number to the account
  // you are already signed in as. Only the endpoint and what we do with the
  // answer differ, so the screen is shared rather than duplicated.
  const linking = params.link === '1';

  const [code, setCode] = useState(params.devCode ?? '');
  const [cooldown, setCooldown] = useState(Number(params.retryAfterS ?? '60'));
  const inputRef = useRef<TextInput>(null);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // A prefilled dev code arrives complete, so onChange never fires —
  // submit it once on mount instead of waiting for a keystroke.
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (autoSubmitted.current || code.length !== CODE_LENGTH) return;
    autoSubmitted.current = true;
    verify.mutate(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = useMutation({
    mutationFn: async (otp: string): Promise<VerifyResult> => {
      if (linking) {
        const user = await apiFetch<UserProfile>('/me/phone/verify', {
          method: 'POST',
          body: { phone, code: otp },
        });
        return { kind: 'linked', user };
      }
      const session = await apiFetch<RiderSession>('/auth/otp/verify', {
        method: 'POST',
        body: { phone, code: otp },
        anonymous: true,
      });
      return { kind: 'session', session };
    },
    onSuccess: async (result) => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.kind === 'linked') {
        // Already signed in — refresh the cached profile and drop back past the
        // phone-entry screen to whatever sent us here, which is the scooter
        // they were trying to unlock.
        setUser(result.user);
        router.back();
        router.back();
        return;
      }
      // Stack.Protected swaps the navigator to (app) once the session lands.
      await signIn(result.session);
    },
    onError: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake.value = withSequence(
        withTiming(-8, { duration: 60 }),
        withTiming(8, { duration: 60 }),
        withTiming(-4, { duration: 60 }),
        withTiming(0, { duration: 60 }),
      );
      setCode('');
      inputRef.current?.focus();
    },
  });

  const resend = useMutation({
    mutationFn: () =>
      linking
        ? apiFetch<{ retryAfterS: number; devCode?: string }>('/me/phone/request', {
            method: 'POST',
            body: { phone },
          })
        : apiFetch<{ retryAfterS: number; devCode?: string }>('/auth/otp/request', {
            method: 'POST',
            body: { phone },
            anonymous: true,
          }),
    onSuccess: (response) => {
      setCooldown(response.retryAfterS);
      if (response.devCode !== undefined) setCode(response.devCode);
    },
  });

  const onChange = (text: string) => {
    const next = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(next);
    if (next.length === CODE_LENGTH && !verify.isPending) verify.mutate(next);
  };

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  return (
    <SafeAreaView style={styles.safe}>
      <IconButton name="back" onPress={() => router.back()} style={styles.back} />

      <View style={styles.container}>
        <Text style={styles.title}>{t.verifyTitle}</Text>
        <Text style={styles.subtitle}>
          {t.verifySubtitle} {formatPhone(phone)}
        </Text>

        <Pressable onPress={() => inputRef.current?.focus()}>
          <Animated.View style={[styles.cells, shakeStyle]}>
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.cell,
                  i === code.length && styles.cellActive,
                  verify.isError && styles.cellError,
                ]}
              >
                <Text style={styles.cellDigit}>{code[i] ?? ''}</Text>
              </View>
            ))}
          </Animated.View>
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          autoFocus
          maxLength={CODE_LENGTH}
          testID="otp-input"
        />

        {verify.isError && (
          <Text style={styles.error}>
            {verify.error instanceof ApiRequestError && verify.error.status === 401
              ? t.wrongCode
              : t.loadingError}
          </Text>
        )}
        {params.devCode !== undefined && <Text style={styles.devHint}>{t.devCodeHint}</Text>}

        {cooldown > 0 ? (
          <Text style={styles.cooldown}>
            {t.resendIn} {cooldown} с
          </Text>
        ) : (
          <Pressable onPress={() => resend.mutate()} disabled={resend.isPending}>
            <Text style={styles.resend}>{t.resendCode}</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  back: { alignSelf: 'flex-start', marginLeft: 20, marginTop: spacing.s },
  container: { flex: 1, padding: 20, gap: spacing.l, paddingTop: spacing.xxl },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary },
  cells: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.l },
  cell: {
    flex: 1,
    height: 60,
    borderRadius: radius.m,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Every cell is outlined ink, so the active one is marked by its volt fill
  // and by lifting — not by a border colour it already has.
  cellActive: { backgroundColor: colors.primary, ...shadows.md },
  cellError: { borderColor: colors.danger },
  cellDigit: {
    ...typography.title,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  error: { fontSize: 13, ...caps, color: colors.danger },
  devHint: { ...typography.caption, color: colors.textSecondary },
  cooldown: { ...typography.body, color: colors.textSecondary, marginTop: spacing.s },
  resend: { fontSize: 15, ...caps, color: colors.text, marginTop: spacing.s },
});
