/**
 * Thin, safe wrapper over the Telegram Mini App bridge. Every call degrades
 * to a no-op in a plain browser so the app is testable outside Telegram.
 */

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  colorScheme: 'light' | 'dark';
  /** Signed payload proving the user's Telegram identity — see /auth/telegram/webapp. */
  initData: string;
  showScanQrPopup(params: { text?: string }, callback: (text: string) => boolean): void;
  closeScanQrPopup(): void;
  showConfirm?(message: string, callback: (ok: boolean) => void): void;
  HapticFeedback?: {
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
}

function webApp(): TelegramWebApp | null {
  const tg = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram;
  return tg?.WebApp ?? null;
}

export function initTelegram(): void {
  const app = webApp();
  if (app === null) return;
  app.ready();
  app.expand();
}

export function isTelegram(): boolean {
  return webApp() !== null;
}

/** True when this Telegram client supports the native QR scanner popup. */
export function canScanQr(): boolean {
  const app = webApp();
  return app !== null && typeof app.showScanQrPopup === 'function';
}

/** Resolves with the scanned text, or null if the user closed the popup. */
export function scanQr(prompt: string): Promise<string | null> {
  const app = webApp();
  if (app === null || typeof app.showScanQrPopup !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      app.showScanQrPopup({ text: prompt }, (text) => {
        resolve(text);
        return true; // close the popup
      });
    } catch {
      resolve(null);
    }
  });
}

export function haptic(type: 'error' | 'success' | 'warning'): void {
  webApp()?.HapticFeedback?.notificationOccurred(type);
}

/** Raw initData for server-side verification; '' outside Telegram. */
export function getInitData(): string {
  return webApp()?.initData ?? '';
}

/** Native Telegram confirm popup, window.confirm outside Telegram. */
export function confirmDialog(message: string): Promise<boolean> {
  const app = webApp();
  if (app?.showConfirm !== undefined) {
    return new Promise((resolve) => {
      try {
        app.showConfirm?.(message, resolve);
      } catch {
        resolve(window.confirm(message));
      }
    });
  }
  return Promise.resolve(window.confirm(message));
}
