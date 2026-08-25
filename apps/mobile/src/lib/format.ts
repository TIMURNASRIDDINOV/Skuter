import { DISPLAY_TIMEZONE, MINUTES_PER_DAY } from '@ozothunder/shared';
import type { Language } from '@/lib/i18n';

const LOCALE: Record<Language, string> = { ru: 'ru-RU', uz: 'uz-UZ', 'zh-Hant': 'zh-Hant' };

/** `14:32` in Asia/Samarkand. */
export function formatTime(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** `28 июля, 14:32` in Asia/Samarkand. */
export function formatDateTime(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: DISPLAY_TIMEZONE,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** `28 июля 2026` in Asia/Samarkand — for subscription expiry dates. */
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
  const unitM = lang === 'uz' ? 'm' : lang === 'zh-Hant' ? '公尺' : 'м';
  const unitKm = lang === 'uz' ? 'km' : lang === 'zh-Hant' ? '公里' : 'км';
  if (metres < 1000) return `${Math.round(metres)} ${unitM}`;
  const km = (metres / 1000).toFixed(1).replace('.', ',');
  return `${km} ${unitKm}`;
}

/**
 * `1 ч 50 мин` / `35 мин` — a duration a person would say out loud.
 *
 * Distinct from `formatDuration`, which is a running clock (`12:34`). This one
 * is for estimates: how long a charge lasts, how long a hold has left.
 */
export function formatMinutes(totalMinutes: number, lang: Language): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const h = lang === 'uz' ? 'soat' : lang === 'zh-Hant' ? '小時' : 'ч';
  const m = lang === 'uz' ? 'daq' : lang === 'zh-Hant' ? '分鐘' : 'мин';
  if (minutes < 60) return `${minutes} ${m}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ${h}` : `${hours} ${h} ${rest} ${m}`;
}

/**
 * How long a rental plan runs — `3 ч`, `24 ч`, `7 дн`.
 *
 * Whole days say days: `168 ч` is technically the same week and reads as a
 * number nobody asked for. Anything shorter falls through to `formatMinutes`,
 * which already knows all three languages.
 */
export function formatPlanDuration(minutes: number | null, lang: Language): string {
  if (minutes === null) return '';
  if (minutes >= MINUTES_PER_DAY && minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    const unit = lang === 'uz' ? 'kun' : lang === 'zh-Hant' ? '天' : 'дн';
    return `${days} ${unit}`;
  }
  return formatMinutes(minutes, lang);
}

/**
 * `02:59:12` — the rental console's countdown to the end of the window.
 *
 * Zero-padded hours, unlike `formatDuration`, because this one ticks in place:
 * a field that shifts from `9:59:59` to `10:00:00` jogs every digit sideways,
 * and the eye reads that as the whole number changing.
 */
export function formatCountdownLong(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** `9:59` — a countdown, always mm:ss. Used by the reservation banner. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** `+998 90 123 45 67` from `+998901234567`. */
export function formatPhone(phone: string): string {
  const match = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  if (match === null) return phone;
  return `+998 ${match[1]} ${match[2]} ${match[3]} ${match[4]}`;
}
