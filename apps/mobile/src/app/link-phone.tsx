import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiRequestError, apiFetch } from '@/api/client';
import { useTelegramLogin } from '@/api/telegram';
import { Button, Icon, IconButton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { caps, colors, outline, radius, shadows, spacing, typography } from '@/lib/theme';

/**
 * Attaching a phone number to an account that signed up with Google or
 * Telegram. Reached from the unlock screen when the API answers
 * `phone_required` — a scooter goes out under somebody's name, so a reachable
 * number is required before the first ride, not at sign-up.
 *
 * Deliberately the same shape as login.tsx: the rider has seen this field
 * before, and the code entry it hands off to is literally the same screen.
 */
export default function LinkPhoneScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [digits, setDigits] = useState('');
  const [focused, setFocused] = useState(false);
  const phone = `+998${digits}`;
  // Telegram hands over a number it has already verified, so this path works
  // with no SMS provider at all — the reliable option while Eskiz is blocked.
  const telegram = useTelegramLogin('link');

  const request = useMutation({
    mutationFn: () =>
      apiFetch<{ retryAfterS: number; devCode?: string }>('/me/phone/request', {
        method: 'POST',
        body: { phone },
      }),
    onSuccess: (response) => {
      router.push({
        pathname: '/verify',
        params: {
          phone,
          link: '1',
          retryAfterS: String(response.retryAfterS),
          ...(response.devCode !== undefined ? { devCode: response.devCode } : {}),
        },
      });
    },
  });

  const valid = /^\d{9}$/.test(digits);
  const status = request.error instanceof ApiRequestError ? request.error.status : null;
  const errorMessage =
    status === 409 ? t.linkPhoneTaken : status === 429 ? t.smsSendFailed : t.loadingError;

  return (
    <SafeAreaView style={styles.safe}>
      <IconButton name="back" onPress={() => router.back()} style={styles.back} />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.hero}>
          <View style={styles.brandMark}>
            <Icon name="keypad" size={40} color={colors.onPrimary} />
          </View>
          <Text style={styles.title}>{t.linkPhoneTitle}</Text>
          <Text style={styles.subtitle}>{t.linkPhoneSubtitle}</Text>
        </View>

        <View style={styles.form}>
          <View
            style={[
              styles.phoneField,
              focused && styles.phoneFieldFocused,
              request.isError && styles.phoneFieldError,
            ]}
          >
            <Text style={styles.phonePrefix}>+998</Text>
            <TextInput
              style={styles.phoneInput}
              value={digits}
              onChangeText={(text) => setDigits(text.replace(/\D/g, '').slice(0, 9))}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              keyboardType="number-pad"
              placeholder={t.phonePlaceholder}
              placeholderTextColor={colors.textSecondary}
              autoFocus
              testID="link-phone-input"
            />
          </View>
          {request.isError && <Text style={styles.error}>{errorMessage}</Text>}
          <Button
            label={t.linkPhoneCta}
            onPress={() => request.mutate()}
            disabled={!valid}
            loading={request.isPending}
          />

          <View style={styles.separatorRow}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>{t.orSeparator}</Text>
            <View style={styles.separatorLine} />
          </View>

          {telegram.waiting ? (
            <View style={styles.telegramWaiting}>
              <Text style={styles.telegramWaitingText}>{t.telegramWaiting}</Text>
              <Button label={t.telegramCancel} variant="ghost" onPress={telegram.cancel} />
            </View>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                testID="telegram-link-phone"
                onPress={() => void telegram.start()}
                style={({ pressed }) => [
                  styles.telegramButton,
                  pressed && styles.telegramButtonPressed,
                ]}
              >
                <Icon name="send" size={18} color={colors.info} />
                <Text style={styles.telegramLabel}>{t.linkPhoneViaTelegram}</Text>
              </Pressable>
              <Text style={styles.telegramHint}>{t.telegramShareHint}</Text>
            </>
          )}
          {telegram.failed && !telegram.waiting && (
            <Text style={styles.error}>{t.telegramFailed}</Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  back: { alignSelf: 'flex-start', marginLeft: 20, marginTop: spacing.s },
  container: { flex: 1, padding: 20, justifyContent: 'center', gap: spacing.xxl },
  hero: { alignItems: 'center', gap: spacing.s },
  brandMark: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.s,
    ...outline,
    ...shadows.md,
  },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  form: { gap: spacing.l },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: spacing.l,
    height: 60,
    gap: spacing.s,
  },
  // As on login: the outline is already ink at rest, so focus is a lift.
  phoneFieldFocused: { ...shadows.md },
  phoneFieldError: { borderColor: colors.danger },
  phonePrefix: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: colors.textSecondary,
  },
  phoneInput: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    color: colors.text,
    flex: 1,
    paddingVertical: 0,
  },
  error: { fontSize: 13, ...caps, color: colors.danger },
  separatorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  separatorLine: { flex: 1, height: 2, backgroundColor: colors.borderSoft },
  separatorText: { fontSize: 11, ...caps, color: colors.textSecondary },
  telegramWaiting: { gap: spacing.s, alignItems: 'center' },
  telegramWaitingText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  // Mirrors the button on login.tsx exactly — same affordance, same look.
  telegramButton: {
    minHeight: 56,
    borderRadius: radius.m,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.m,
    backgroundColor: colors.surface,
    ...outline,
    ...shadows.md,
  },
  telegramButtonPressed: {
    backgroundColor: colors.surfaceMuted,
    transform: [{ translateY: 2 }],
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  telegramLabel: { fontSize: 15, ...caps, letterSpacing: 0.4, color: colors.text },
  telegramHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
  },
});
