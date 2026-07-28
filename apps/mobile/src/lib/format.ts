import { DISPLAY_TIMEZONE } from '@scoot/shared';
import type { Language } from '@/lib/i18n';

const LOCALE: Record<Language, string> = { ru: 'ru-RU', uz: 'uz-UZ' };

/** `14:32` in Asia/Tashkent. */
export function formatTime(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** `28 июля, 14:32` in Asia/Tashkent. */
export function formatDateTime(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: DISPLAY_TIMEZONE,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** `28 июля 2026` in Asia/Tashkent — for subscription expiry dates. */
export function formatDate(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: DISPLAY_TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** `12:34` under an hour, `1:02:34` above. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/** `320 м` below a kilometre, `1,2 км` above. */
export function formatDistance(metres: number, lang: Language): string {
  const unitM = lang === 'uz' ? 'm' : 'м';
  const unitKm = lang === 'uz' ? 'km' : 'км';
  if (metres < 1000) return `${Math.round(metres)} ${unitM}`;
  const km = (metres / 1000).toFixed(1).replace('.', ',');
  return `${km} ${unitKm}`;
}

/** `+998 90 123 45 67` from `+998901234567`. */
export function formatPhone(phone: string): string {
  const match = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  if (match === null) return phone;
  return `+998 ${match[1]} ${match[2]} ${match[3]} ${match[4]}`;
}
