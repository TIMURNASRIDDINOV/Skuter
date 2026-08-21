import { z } from 'zod';

/**
 * Google Sign-In ID token verification. WebCrypto only (`crypto.subtle`), so
 * the same code runs on Node ≥20 and Cloudflare Workers with no dependencies —
 * the same constraint `lib/telegram.ts` respects, and the reason
 * `google-auth-library` is not used here.
 *
 * The token is a JWT the Google SDK on the phone hands us. It proves the user
 * signed in to Google, but on its own proves nothing about *which app* they
 * signed in to — an ID token minted for any other project is still validly
 * signed by Google. Checking `aud` against our own client ids is what makes it
 * an authentication rather than a signature check, so all of these are
 * verified, not just the signature:
 *
 *   - RS256 signature against Google's published keys, algorithm pinned;
 *   - `iss` is Google;
 *   - `aud` is one of *our* client ids;
 *   - `exp` is in the future (with a small clock skew allowance);
 *   - `email_verified` — an unverified email must not become an account key.
 */

/**
 * `CryptoKey` inferred rather than named: the global type ships with the DOM
 * lib, which this workspace deliberately does not include (see
 * tsconfig.base.json). Inferring it keeps the file honest under both the Node
 * and the Workers typecheck.
 */
type VerifyKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** Pinned explicitly — leaving the algorithm to the token is how `alg: none` gets in. */
const ALGORITHM = 'RS256';

/** Tolerance for a phone whose clock is slightly ahead of ours. */
const CLOCK_SKEW_S = 60;

/** Fallback cache lifetime when Google's response carries no usable max-age. */
const DEFAULT_KEY_TTL_MS = 60 * 60 * 1000;

const jwkSchema = z.object({
  kid: z.string(),
  kty: z.literal('RSA'),
  n: z.string(),
  e: z.string(),
  alg: z.string().optional(),
});

const certsSchema = z.object({ keys: z.array(jwkSchema) });

const headerSchema = z.object({
  alg: z.string(),
  kid: z.string(),
});

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().min(1),
  exp: z.int(),
  email: z.email().optional(),
  email_verified: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
  name: z.string().optional(),
});

export interface GoogleIdentity {
  /** Google's stable account id. The only key we match an account on. */
  googleSub: string;
  email: string;
  /** Display name, null when Google did not supply one. */
  name: string | null;
}

/**
 * Verifies an ID token and returns the identity inside it, or **null** for any
 * failure — malformed, wrong audience, expired, bad signature, unverified
 * email. Callers turn that into one opaque 401 so a probe cannot learn which
 * check it tripped.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  allowedClientIds: readonly string[],
): Promise<GoogleIdentity | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  const header = headerSchema.safeParse(decodeJson(rawHeader));
  if (!header.success || header.data.alg !== ALGORITHM) return null;

  const key = await findKey(header.data.kid);
  if (key === null) return null;

  const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const signature = decodeBase64Url(rawSignature);
  if (signature === null) return null;

  const valid = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, signed);
  if (!valid) return null;

  const claims = claimsSchema.safeParse(decodeJson(rawPayload));
  if (!claims.success) return null;
  const { iss, aud, sub, exp, email, email_verified: emailVerified, name } = claims.data;

  if (!VALID_ISSUERS.includes(iss)) return null;
  if (!allowedClientIds.includes(aud)) return null;
  if (exp + CLOCK_SKEW_S < Math.floor(Date.now() / 1000)) return null;

  // An account is keyed on `sub`, but the email is shown to admins and to the
  // rider, and an unverified one is attacker-controlled text.
  if (email === undefined) return null;
  if (emailVerified !== true && emailVerified !== 'true') return null;

  return { googleSub: sub, email, name: name ?? null };
}

// --- Google's signing keys -------------------------------------------------

interface KeyCache {
  keys: Map<string, VerifyKey>;
  expiresAt: number;
}

let cache: KeyCache | null = null;
/** In-flight fetch, so a burst of sign-ins on a cold isolate fetches once. */
let inFlight: Promise<KeyCache> | null = null;

/** Exposed for tests, which install their own key set. */
export function __setGoogleKeyCache(keys: Map<string, VerifyKey>, expiresAt: number): void {
  cache = { keys, expiresAt };
  inFlight = null;
}

async function findKey(kid: string): Promise<VerifyKey | null> {
  const fresh = cache !== null && cache.expiresAt > Date.now();
  const cached = fresh ? (cache?.keys.get(kid) ?? null) : null;
  if (cached !== null) return cached;

  // A `kid` we have never seen means Google rotated — refetch even if the
  // cache has not expired yet, otherwise every sign-in fails until it does.
  const loaded = await loadKeys();
  return loaded.keys.get(kid) ?? null;
}

async function loadKeys(): Promise<KeyCache> {
  inFlight ??= fetchKeys().finally(() => {
    inFlight = null;
  });
  cache = await inFlight;
  return cache;
}

async function fetchKeys(): Promise<KeyCache> {
  const response = await fetch(CERTS_URL);
  if (!response.ok) {
    throw new Error(`Could not fetch Google signing keys (${response.status})`);
  }

  const parsed = certsSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Google signing keys were not in the expected format');
  }

  const keys = new Map<string, VerifyKey>();
  for (const jwk of parsed.data.keys) {
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: ALGORITHM, ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }

  return { keys, expiresAt: Date.now() + maxAgeMs(response) };
}

/** Google publishes a long `max-age` on the cert endpoint; respect it. */
function maxAgeMs(response: Response): number {
  const header = response.headers.get('cache-control');
  const match = header === null ? null : /max-age=(\d+)/.exec(header);
  if (match?.[1] === undefined) return DEFAULT_KEY_TTL_MS;
  return Number.parseInt(match[1], 10) * 1000;
}

// --- base64url -------------------------------------------------------------

function decodeBase64Url(value: string): Uint8Array | null {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeJson(value: string): unknown {
  const bytes = decodeBase64Url(value);
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
