import { beforeAll, describe, expect, it } from 'vitest';
import { __setGoogleKeyCache, verifyGoogleIdToken } from './google.js';

/**
 * ID tokens are signed with a keypair generated here, and the public half is
 * pushed into the module's key cache. Nothing reaches Google — a test that
 * needed the network could not assert on an expired or tampered token.
 */

const CLIENT_ID = '1234567890-ios.apps.googleusercontent.com';
const OTHER_CLIENT_ID = '9999999999-web.apps.googleusercontent.com';
const KID = 'test-key-1';

/** Inferred, for the same reason as in google.ts — no DOM lib in this build. */
type Keys = Awaited<ReturnType<typeof crypto.subtle.generateKey>>;
let signingKey: Extract<Keys, { privateKey: unknown }>['privateKey'];

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  signingKey = pair.privateKey;
  __setGoogleKeyCache(new Map([[KID, pair.publicKey]]), Date.now() + 60_000);
});

function base64Url(bytes: Uint8Array | string): string {
  const binary =
    typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface ClaimOverrides {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

async function signedToken(
  overrides: ClaimOverrides = {},
  header: Record<string, string> = {},
): Promise<string> {
  const claims = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '110169484474386276334',
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'rider@example.com',
    email_verified: true,
    name: 'Temur',
    ...overrides,
  };

  const encodedHeader = base64Url(JSON.stringify({ alg: 'RS256', kid: KID, ...header }));
  const encodedPayload = base64Url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    signingKey,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );

  return `${encodedHeader}.${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
}

describe('verifyGoogleIdToken', () => {
  it('accepts a correctly signed token for a configured client id', async () => {
    const identity = await verifyGoogleIdToken(await signedToken(), [CLIENT_ID]);

    expect(identity).toEqual({
      googleSub: '110169484474386276334',
      email: 'rider@example.com',
      name: 'Temur',
    });
  });

  it('accepts a token whose audience is any one of several client ids', async () => {
    const identity = await verifyGoogleIdToken(await signedToken(), [OTHER_CLIENT_ID, CLIENT_ID]);

    expect(identity).not.toBeNull();
  });

  /**
   * The check that turns a signature test into an authentication test: a token
   * minted for a different project is still validly signed by Google.
   */
  it('rejects a validly signed token issued for another application', async () => {
    const token = await signedToken({ aud: OTHER_CLIENT_ID });

    expect(await verifyGoogleIdToken(token, [CLIENT_ID])).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signedToken({ exp: Math.floor(Date.now() / 1000) - 3600 });

    expect(await verifyGoogleIdToken(token, [CLIENT_ID])).toBeNull();
  });

  it('rejects a token whose payload was altered after signing', async () => {
    const [header, , signature] = (await signedToken()).split('.') as [string, string, string];
    const forged = base64Url(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: 'somebody-elses-account',
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'attacker@example.com',
        email_verified: true,
      }),
    );

    expect(await verifyGoogleIdToken(`${header}.${forged}.${signature}`, [CLIENT_ID])).toBeNull();
  });

  it('rejects an issuer that is not Google', async () => {
    const token = await signedToken({ iss: 'https://accounts.evil.example' });

    expect(await verifyGoogleIdToken(token, [CLIENT_ID])).toBeNull();
  });

  /** An unverified address must never become the email shown on an account. */
  it('rejects a token whose email is not verified', async () => {
    const token = await signedToken({ email_verified: false });

    expect(await verifyGoogleIdToken(token, [CLIENT_ID])).toBeNull();
  });

  it('rejects a token with no email at all', async () => {
    const token = await signedToken({ email: undefined });

    expect(await verifyGoogleIdToken(token, [CLIENT_ID])).toBeNull();
  });

  /** `alg: none` is the classic JWT bypass; the algorithm is pinned. */
  it('rejects a token that asks for an unexpected algorithm', async () => {
    const token = await signedToken({}, { alg: 'none' });

    expect(await verifyGoogleIdToken(token, [CLIENT_ID])).toBeNull();
  });

  it('rejects a token signed by a key we do not know', async () => {
    const token = await signedToken({}, { kid: 'some-other-key' });

    expect(await verifyGoogleIdToken(token, [CLIENT_ID])).toBeNull();
  });

  it.each(['', 'not-a-jwt', 'only.two'])('rejects the malformed token %j', async (token) => {
    expect(await verifyGoogleIdToken(token, [CLIENT_ID])).toBeNull();
  });
});
