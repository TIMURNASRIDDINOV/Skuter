import type { RiderSession } from '@scoot/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiRequestError, apiFetch, setToken } from '../api';
import { getInitData } from '../telegram';

/**
 * Inside Telegram the user is already authenticated — the signed initData
 * logs them in without any input (verified server-side against the bot
 * token). The phone OTP form remains for plain browsers; in development the
 * API returns the fixed code with the request, so the field pre-fills and
 * the demo never depends on an SMS provider.
 *
 * The number to pre-fill comes from `VITE_DEMO_PHONE` rather than the source.
 * It used to be hardcoded, which put a real personal number in a public
 * repository — and, with the sign-in allowlist, told a reader exactly which
 * number the deployed build accepts. `.env` is gitignored; empty is fine, it
 * just means typing it.
 */
const DEMO_PHONE: string = import.meta.env['VITE_DEMO_PHONE'] ?? '';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [phone, setPhone] = useState(DEMO_PHONE);
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telegramPending, setTelegramPending] = useState(() => getInitData() !== '');
  const attempted = useRef(false);

  useEffect(() => {
    const initData = getInitData();
    if (initData === '' || attempted.current) return;
    attempted.current = true;
    apiFetch<RiderSession>('/auth/telegram/webapp', {
      method: 'POST',
      body: { initData },
      anonymous: true,
    })
      .then((session) => {
        setToken(session.token);
        onLoggedIn();
      })
      .catch(() => {
        // Fall back to the phone form — initData may be stale or the
        // endpoint not configured.
        setTelegramPending(false);
      });
  }, [onLoggedIn]);

  if (telegramPending) {
    return (
      <div className="screen login">
        <div className="login-hero">🛴</div>
        <h1>Scoot</h1>
        <p className="muted">Входим через Telegram…</p>
      </div>
    );
  }

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
      const result = await apiFetch<RiderSession>('/auth/otp/verify', {
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
