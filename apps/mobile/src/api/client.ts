import type { ApiError, ApiErrorCode } from '@ozothunder/shared';
import * as SecureStore from 'expo-secure-store';

/**
 * Mirror of apps/admin/src/lib/api.ts, with SecureStore in place of
 * localStorage. The token is additionally cached in memory so request
 * building stays synchronous.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

const TOKEN_KEY = 'ozothunder.token';
const USER_KEY = 'ozothunder.user';

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export async function loadStoredToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}

export async function setToken(next: string): Promise<void> {
  token = next;
  await SecureStore.setItemAsync(TOKEN_KEY, next);
}

export async function clearToken(): Promise<void> {
  token = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

export function hasToken(): boolean {
  return token !== null;
}

/** Session provider registers here; a 401 anywhere signs the user out. */
export function registerUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export const userStorage = {
  async load(): Promise<string | null> {
    return SecureStore.getItemAsync(USER_KEY);
  },
  async save(json: string): Promise<void> {
    await SecureStore.setItemAsync(USER_KEY, json);
  },
};

export class ApiRequestError extends Error {
  readonly status: number;
  /** One of API_ERROR_CODES — the shared schema keeps the type open. */
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
