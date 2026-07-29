import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiRequestError, apiFetch } from '@/api/client';
import { useTelegramLogin } from '@/api/telegram';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface OtpResponse {
  retryAfterS: number;
  devCode?: string;
}

export default function LoginScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [digits, setDigits] = useState('');
  const phone = `+998${digits}`;
  const telegram = useTelegramLogin();

  const request = useMutation({
    mutationFn: () =>
      apiFetch<OtpResponse>('/auth/otp/request', {
        method: 'POST',
        body: { phone },
        anonymous: true,
      }),
    onSuccess: (response) => {
      router.push({
        pathname: '/verify',
        params: {
          phone,
          retryAfterS: String(response.retryAfterS),
          ...(response.devCode !== undefined ? { devCode: response.devCode } : {}),
        },
      });
    },
    onError: (error) => {
      // A cooldown means a code is already on its way — proceed to entry.
      if (error instanceof ApiRequestError && error.status === 429) {
        const retryAfterS =
          typeof (error.details as { retryAfterS?: unknown } | null)?.retryAfterS === 'number'
            ? String((error.details as { retryAfterS: number }).retryAfterS)
            : '60';
        router.push({ pathname: '/verify', params: { phone, retryAfterS } });
      }
    },
  });

  const valid = /^\d{9}$/.test(digits);
  const failed =
    request.isError && !(request.error instanceof ApiRequestError && request.error.status === 429);
  const errorMessage =
    request.error instanceof ApiRequestError && request.error.status === 403
      ? t.testOnlyPhone
      : t.loadingError;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.hero}>
          <Text style={styles.logo}>🛴</Text>
          <Text style={styles.title}>{t.loginTitle}</Text>
          <Text style={styles.subtitle}>{t.loginSubtitle}</Text>
        </View>

        <View style={styles.form}>
          <View style={[styles.phoneField, failed && styles.phoneFieldError]}>
            <Text style={styles.phonePrefix}>+998</Text>
            <TextInput
              style={styles.phoneInput}
              value={digits}
              onChangeText={(text) => setDigits(text.replace(/\D/g, '').slice(0, 9))}
              keyboardType="number-pad"
              placeholder={t.phonePlaceholder}
              placeholderTextColor={colors.textSecondary}
              autoFocus
              testID="phone-input"
            />
          </View>
          {failed && <Text style={styles.error}>{errorMessage}</Text>}
          <Button
            label={t.sendCode}
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
            <Button
              label={t.continueWithTelegram}
              variant="secondary"
              onPress={() => void telegram.start()}
              testID="telegram-login"
            />
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
  safe: { flex: 1, backgroundColor: colors.surface },
  container: { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.xxl },
  hero: { alignItems: 'center', gap: spacing.s },
  logo: { fontSize: 56 },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  form: { gap: spacing.l },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.l,
    height: 56,
    gap: spacing.s,
  },
  phoneFieldError: { borderColor: colors.danger },
  phonePrefix: { ...typography.heading, color: colors.text },
  phoneInput: { ...typography.heading, color: colors.text, flex: 1, paddingVertical: 0 },
  error: { ...typography.label, color: colors.danger },
  separatorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  separatorLine: { flex: 1, height: 1, backgroundColor: colors.border },
  separatorText: { ...typography.caption, color: colors.textSecondary },
  telegramWaiting: { gap: spacing.s, alignItems: 'center' },
  telegramWaitingText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
