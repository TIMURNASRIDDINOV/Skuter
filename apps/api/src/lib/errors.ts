import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { API_ERROR_CODES, type ApiErrorCode } from '@scoot/shared';

/**
 * Every failure the API returns deliberately is an ApiHttpError. The global
 * error handler turns it into the `apiErrorSchema` body clients branch on;
 * anything else becomes an opaque 500 so internals never leak.
 */
export class ApiHttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(
    status: ContentfulStatusCode,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): ApiHttpError =>
  new ApiHttpError(400, API_ERROR_CODES.VALIDATION_FAILED, message, details);

export const unauthorized = (message = 'Authentication required'): ApiHttpError =>
  new ApiHttpError(401, API_ERROR_CODES.UNAUTHORIZED, message);

export const forbidden = (message = 'Not permitted'): ApiHttpError =>
  new ApiHttpError(403, API_ERROR_CODES.FORBIDDEN, message);

export const notFound = (message = 'Not found'): ApiHttpError =>
  new ApiHttpError(404, API_ERROR_CODES.NOT_FOUND, message);

export const conflict = (code: ApiErrorCode, message: string, details?: unknown): ApiHttpError =>
  new ApiHttpError(409, code, message, details);

export const tooManyRequests = (message: string, details?: unknown): ApiHttpError =>
  new ApiHttpError(429, API_ERROR_CODES.VALIDATION_FAILED, message, details);

/**
 * Phase 2 seam. The IoT gateway throws this so it is obvious the code path
 * exists but is not wired to real hardware yet.
 */
export class NotImplementedError extends ApiHttpError {
  constructor(message: string) {
    super(501, API_ERROR_CODES.NOT_IMPLEMENTED, message);
    this.name = 'NotImplementedError';
  }
}
