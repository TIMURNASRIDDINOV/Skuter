import type { ApiError } from '@scoot/shared';

/**
 * Thin fetch wrapper around the Scoot API. Every call carries the admin bearer
 * token and surfaces the API's structured error body.
 */

export const API_URL: string = import.meta.env['VITE_API_URL'] ?? 'http://localhost:8787';

const TOKEN_KEY = 'scoot.admin.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (!response.ok) {
    let code = 'internal';
    let message = `Запрос не удался (${response.status})`;
    try {
      const body = (await response.json()) as ApiError;
      code = body.error.code;
      message = body.error.message;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiRequestError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Every list endpoint returns this envelope. */
export interface ListResponse<T> {
  items: T[];
  total: number;
}
