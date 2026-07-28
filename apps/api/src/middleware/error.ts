import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { API_ERROR_CODES, type ApiError } from '@scoot/shared';
import { isProduction } from '../env.js';
import { ApiHttpError } from '../lib/errors.js';
import { logError } from '../lib/logger.js';

/**
 * Single error boundary. Deliberate failures keep their code and message;
 * everything else becomes an opaque 500 so internals never reach a client.
 */
export function handleError(error: Error, c: Context): Response {
  if (error instanceof ApiHttpError) {
    const body: ApiError = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
    return c.json(body, error.status);
  }

  if (error instanceof ZodError) {
    const body: ApiError = {
      error: {
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Request failed validation',
        details: error.issues,
      },
    };
    return c.json(body, 400);
  }

  if (error instanceof HTTPException) {
    const body: ApiError = {
      error: { code: API_ERROR_CODES.INTERNAL, message: error.message },
    };
    return c.json(body, error.status);
  }

  logError('Unhandled error', error);

  const body: ApiError = {
    error: {
      code: API_ERROR_CODES.INTERNAL,
      message: 'Something went wrong',
      // Stacks are useful while developing the demo, never in production.
      ...(isProduction ? {} : { details: error.message }),
    },
  };
  return c.json(body, 500);
}

export function handleNotFound(c: Context): Response {
  const body: ApiError = {
    error: {
      code: API_ERROR_CODES.NOT_FOUND,
      message: `No route for ${c.req.method} ${c.req.path}`,
    },
  };
  return c.json(body, 404);
}
