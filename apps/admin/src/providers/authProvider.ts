import type { AuthProvider } from '@refinedev/core';
import type { Admin, AdminSession } from '@ozothunder/shared';
import { API_URL, ApiRequestError, apiFetch, clearToken, getToken, setToken } from '../lib/api.js';

/**
 * Email + password against the API. The token lives in localStorage; there is
 * no refresh flow because tokens are long-lived for the demo.
 */
export const authProvider: AuthProvider = {
  async login({ email, password }: { email?: string; password?: string }) {
    try {
      const response = await fetch(`${API_URL}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: { name: 'Не удалось войти', message: 'Неверная почта или пароль' },
        };
      }

      const session = (await response.json()) as AdminSession;
      setToken(session.token);
      return { success: true, redirectTo: '/' };
    } catch {
      // Name the address that failed. The old message said only "check that it
      // is running", which is useless advice on a hosted panel and actively
      // misleading when the real cause is a stale bundle still pointing at
      // localhost: an https page calling http:// is blocked as mixed content,
      // and a blocked fetch throws exactly like an unreachable server.
      const mixedContent =
        globalThis.location.protocol === 'https:' && API_URL.startsWith('http://');

      return {
        success: false,
        error: {
          name: 'Нет соединения',
          message: mixedContent
            ? `Страница открыта по https, а API указан как ${API_URL} — браузер блокирует такой запрос. Обновите страницу с очисткой кэша (Cmd/Ctrl+Shift+R).`
            : `Не удалось связаться с API по адресу ${API_URL}.`,
        },
      };
    }
  },

  async logout() {
    clearToken();
    return { success: true, redirectTo: '/login' };
  },

  async check() {
    if (getToken() === null) return { authenticated: false, redirectTo: '/login' };

    try {
      await apiFetch<Admin>('/admin/auth/me');
      return { authenticated: true };
    } catch {
      clearToken();
      return { authenticated: false, redirectTo: '/login' };
    }
  },

  async getIdentity() {
    try {
      const admin = await apiFetch<Admin>('/admin/auth/me');
      return { id: admin.id, name: admin.email, role: admin.role };
    } catch {
      return null;
    }
  },

  async onError(error) {
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
      clearToken();
      return { logout: true, redirectTo: '/login' };
    }
    return {};
  },
};
