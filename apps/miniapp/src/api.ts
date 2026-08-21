import type { ApiError, ApiErrorCode } from '@ozothunder/shared';

/**
 * Mirror of apps/mobile/src/api/client.ts with localStorage in place of
 * SecureStore — a Telegram WebView has no secure enclave to offer anyway.
 */

export const API_URL: string = import.meta.env['VITE_API_URL'] ?? 'http://localhost:8787';

const TOKEN_KEY = 'ozothunder.token';

let token: string | null = localStorage.getItem(TOKEN_KEY);
let onUnauthorized: (() => void) | null = null;

export function setToken(next: string): void {
  token = next;
  localStorage.setItem(TOKEN_KEY, next);
}

export function clearToken(): void {
  token = null;
  localStorage.removeItem(TOKEN_KEY);
}

export function hasToken(): boolean {
  return token !== null;
}

/** App shell registers here; a 401 anywhere signs the user out. */
export function registerUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | (string & {});
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header — the OTP endpoints. */
  anonymous?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!options.anonymous && token !== null) headers['Authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiRequestError(0, 'internal', 'Network request failed', null);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as { error?: ApiError['error'] } | null)?.error;
    const code = error?.code ?? 'internal';
    if (response.status === 401 && code === 'unauthorized' && !options.anonymous) {
      onUnauthorized?.();
    }
    throw new ApiRequestError(
      response.status,
      code,
      error?.message ?? `Request failed with ${response.status}`,
      error?.details ?? null,
    );
  }

  return payload as T;
}
