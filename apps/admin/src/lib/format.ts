import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import 'dayjs/locale/ru.js';
import { DISPLAY_TIMEZONE, formatSom } from '@scoot/shared';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.locale('ru');

/** Timestamps arrive as UTC and are displayed in Asia/Tashkent throughout. */
export function formatDateTime(iso: string | null): string {
  if (iso === null) return '—';
  return dayjs(iso).tz(DISPLAY_TIMEZONE).format('DD.MM.YYYY HH:mm');
}

export function formatTime(iso: string | null): string {
  if (iso === null) return '—';
  return dayjs(iso).tz(DISPLAY_TIMEZONE).format('HH:mm:ss');
}

export function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  return dayjs(iso).tz(DISPLAY_TIMEZONE).format('DD.MM.YYYY');
}

export function formatRelative(iso: string | null): string {
  if (iso === null) return '—';
  return dayjs(iso).fromNow();
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Russian noun agreement: 1 самокат, 2–4 самоката, 5+ самокатов. The back
 * office is Russian-only, so counted nouns have to decline or the summary
 * lines read as machine output.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} км` : `${Math.round(metres)} м`;
}

export { formatSom };
