import { sign, verify } from 'hono/jwt';
import { jwtClaimsSchema, type JwtClaims, type JwtRole } from '@scoot/shared';
import { env } from '../env.js';
import { unauthorized } from './errors.js';

/** Duration strings like `30d`, `12h`, `45m`, `90s`. */
const DURATION_PATTERN = /^(\d+)([smhd])$/;

const MULTIPLIERS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

export function parseDurationSeconds(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (match === null) {
    throw new Error(`Invalid duration "${value}" — expected something like 30d, 12h, 45m or 90s`);
  }
  const [, amount, unit] = match;
  const multiplier = unit === undefined ? undefined : MULTIPLIERS[unit];
  if (amount === undefined || multiplier === undefined) {
    throw new Error(`Invalid duration "${value}"`);
  }
  return Number.parseInt(amount, 10) * multiplier;
}

/**
 * Pinned explicitly on both sign and verify. Leaving the algorithm implicit is
 * how algorithm-confusion attacks get in.
 */
const ALGORITHM = 'HS256' as const;

export async function issueToken(subject: string, role: JwtRole): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = {
    sub: subject,
    role,
    iat: issuedAt,
    exp: issuedAt + parseDurationSeconds(env.JWT_EXPIRES_IN),
  };
  return sign(claims, env.JWT_SECRET, ALGORITHM);
}

/** Verifies signature and expiry, then shape-checks the payload. */
export async function readToken(token: string): Promise<JwtClaims> {
  let payload: unknown;
  try {
    payload = await verify(token, env.JWT_SECRET, ALGORITHM);
  } catch {
    throw unauthorized('Token is invalid or has expired');
  }

  const parsed = jwtClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw unauthorized('Token payload is malformed');
  }
  return parsed.data;
}
