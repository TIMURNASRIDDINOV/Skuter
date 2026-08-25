import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import 'dayjs/locale/ru.js';
import { DISPLAY_TIMEZONE, MINUTES_PER_DAY, formatSom } from '@ozothunder/shared';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.locale('ru');

/** Timestamps arrive as UTC and are displayed in Asia/Samarkand throughout. */
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

/**
 * Compact relative time for dense tables — `8 с`, `12 мин`, `3 ч`, `2 дн`.
 *
 * `formatRelative` is the right thing in prose, but "несколько секунд назад"
 * wraps to two lines in a table cell and doubles every row's height, which on
 * a live fleet list is most of the rows most of the time.
 */
export function formatAgo(iso: string | null): string {
  if (iso === null) return '—';

  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${String(seconds)} с`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} мин`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} ч`;

  return `${String(Math.floor(hours / 24))} дн`;
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
 * A rental's length, from the minutes it is stored as — `3 часа`, `24 часа`,
 * `7 дней`.
 *
 * Whole days read as days because that is how the office sells them: an
 * operator granting a fortnight thinks in weeks, not in 20 160 minutes.
 */
export function formatRentalDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return `${String(days)} ${plural(days, 'день', 'дня', 'дней')}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${String(hours)} ${plural(hours, 'час', 'часа', 'часов')}`;
  }
  return `${String(minutes)} мин`;
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
