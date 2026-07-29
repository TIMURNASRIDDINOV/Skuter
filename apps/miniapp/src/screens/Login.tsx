import type { UserProfile } from '@scoot/shared';
import { useState } from 'react';
import { ApiRequestError, apiFetch, setToken } from '../api';

/**
 * Phone → OTP, same two endpoints the native app uses. In development the
 * API returns the fixed code with the request, so the field pre-fills and
 * the demo never depends on an SMS provider.
 */
export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [phone, setPhone] = useState('+998882196446');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ retryAfterS: number; devCode?: string }>(
        '/auth/otp/request',
        { method: 'POST', body: { phone: phone.trim() }, anonymous: true },
      );
      if (result.devCode !== undefined) setCode(result.devCode);
      setStage('code');
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Не удалось отправить код');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ token: string; user: UserProfile }>('/auth/otp/verify', {
        method: 'POST',
        body: { phone: phone.trim(), code: code.trim() },
        anonymous: true,
      });
      setToken(result.token);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen login">
      <div className="login-hero">🛴</div>
      <h1>Вход в Scoot</h1>
      <p className="muted">
        {stage === 'phone'
          ? 'Введите номер телефона — отправим код подтверждения'
          : 'Введите код из SMS'}
      </p>

      {stage === 'phone' ? (
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+998 90 123 45 67"
          autoComplete="tel"
        />
      ) : (
        <input
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="000000"
          maxLength={6}
        />
      )}

      {error !== null && <div className="error-box">{error}</div>}

      <button
        className="btn primary"
        disabled={busy || (stage === 'phone' ? phone.trim().length < 9 : code.trim().length !== 6)}
        onClick={() => void (stage === 'phone' ? requestCode() : verify())}
      >
        {busy ? '…' : stage === 'phone' ? 'Получить код' : 'Войти'}
      </button>

      {stage === 'code' && (
        <button className="btn ghost" onClick={() => setStage('phone')}>
          Изменить номер
        </button>
      )}
    </div>
  );
}
