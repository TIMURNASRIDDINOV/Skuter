import { z } from 'zod';

/**
 * Environment loading and validation. The process refuses to start on invalid
 * config rather than failing later with a confusing runtime error.
 *
 * A single root .env serves the whole monorepo; see .env.example for the
 * documented list of variables. On Cloudflare Workers there is no .env —
 * `nodejs_compat` populates process.env from the Worker's vars and secrets,
 * and the node:fs branch below never runs.
 */

const isWorkers =
  (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ===
  'Cloudflare-Workers';

if (!isWorkers) {
  const { existsSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { config: loadDotenv } = await import('dotenv');

  const here = dirname(fileURLToPath(import.meta.url));
  const rootEnvPath = resolve(here, '../../..', '.env');
  if (existsSync(rootEnvPath)) {
    loadDotenv({ path: rootEnvPath, quiet: true });
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — see .env.example'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters — generate with: openssl rand -hex 32'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  // Supplied as a **secret**, not a var — it is a working credential on any
  // instance with dev features on, and vars live in wrangler.jsonc, which is
  // in a public repository. Optional here so a missing one can be caught
  // below with a message that says what to do, rather than silently becoming
  // a guessable default on a deployed instance.
  DEV_OTP_CODE: z
    .string()
    .regex(/^\d{6}$/, 'DEV_OTP_CODE must be six digits')
    .optional(),
  // Comma-separated E.164 numbers that may ALSO sign in with the fixed
  // DEV_OTP_CODE, skipping the SMS. Empty = nobody bypasses, which is the safe
  // default. This is a demo affordance, not a gate: everyone can sign in, and
  // these numbers simply do not have to wait on a carrier.
  //
  // A secret rather than a var: it is a list of real personal phone numbers,
  // and wrangler.jsonc is in a public repository.
  OTP_BYPASS_PHONES: z.string().optional(),
  // Which SmsGateway to use. `console` writes the code to the log; `eskiz`
  // sends a real SMS. Defaults to `console` unless Eskiz credentials are set,
  // so local development never spends provider credit by accident.
  SMS_GATEWAY: z.enum(['console', 'eskiz']).optional(),
  ESKIZ_EMAIL: z.string().optional(),
  ESKIZ_PASSWORD: z.string().optional(),
  // Sender id ("alpha name"). 4546 is Eskiz's shared default; a branded one
  // has to be requested from them and needs a signed contract.
  ESKIZ_FROM: z.string().default('4546'),
  // Comma-separated Google OAuth client ids (iOS, Android, Web) accepted as
  // the `aud` of an ID token. Not secret — client ids are public by design —
  // so these live as vars in wrangler.jsonc. Unset = /auth/google answers 501.
  GOOGLE_CLIENT_IDS: z.string().optional(),
  SIMULATOR_TICK_MS: z.coerce.number().int().min(250).max(60_000).default(3000),
  SIMULATOR_UNLOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.08),
  // `durable` = the Cloudflare Workers deployment, where the simulator lives
  // in the FleetSimulator Durable Object and is reached over RPC.
  VEHICLE_GATEWAY: z.enum(['simulated', 'iot', 'durable']).default('simulated'),
  // Explicit override for the dev affordances (fixed OTP code, /dev/simulate/*).
  // Unset = derived from NODE_ENV. The pre-release deployment runs with
  // NODE_ENV=production DEV_FEATURES=true: there is no SMS provider yet, so
  // the fixed OTP code is the only way phone login can work.
  DEV_FEATURES: z.enum(['true', 'false']).optional(),
  // Required to reach /dev/simulate/* on a deployed instance, sent as
  // X-Dev-Secret. Unset in production = those routes stay off, so a deploy
  // cannot leave "start a ride on any scooter" open by omission. Ignored
  // locally, where the whole point is firing them from a terminal unauthed.
  DEV_ROUTES_SECRET: z.string().min(16).optional(),
  // Telegram login. Unset = the /auth/telegram/* endpoints answer 501.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().default('Scootrentuzbot'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
}

export const env = parsed.data;

export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';

/**
 * Dev affordances: the fixed OTP code and the /dev/simulate/* endpoints used
 * to trigger fleet states live during the demo. Derived from NODE_ENV unless
 * DEV_FEATURES overrides it explicitly (the pre-release deployment).
 */
export const devFeaturesEnabled =
  env.DEV_FEATURES !== undefined ? env.DEV_FEATURES === 'true' : !isProduction;

/**
 * The fixed OTP accepted while dev features are on.
 *
 * Local development falls back to `000000` — convenient, and nothing there is
 * reachable from outside. A deployed instance must set it explicitly, because
 * with `DEV_FEATURES=true` this code signs anybody in as any phone number, and
 * a shared fallback on a public URL is an open door. Refusing to start is the
 * same contract as the rest of this file: bad config fails now, loudly, rather
 * than later and quietly.
 */
export const devOtpCode: string = ((): string => {
  if (env.DEV_OTP_CODE !== undefined) return env.DEV_OTP_CODE;
  if (devFeaturesEnabled && isProduction) {
    throw new Error(
      'DEV_OTP_CODE is required when DEV_FEATURES=true on a deployed instance.\n' +
        'Set it as a secret, never as a var in wrangler.jsonc:\n' +
        '  pnpm -F @scoot/api exec wrangler secret put DEV_OTP_CODE',
    );
  }
  return '000000';
})();

/** Shared secret guarding /dev/simulate/* on a deployed instance. */
export const devRoutesSecret: string | null = env.DEV_ROUTES_SECRET ?? null;

/** Telegram login is available only when the bot token is configured. */
export const telegramAuthEnabled = env.TELEGRAM_BOT_TOKEN !== undefined;

/**
 * Numbers that may sign in with the fixed `DEV_OTP_CODE` instead of waiting
 * for an SMS. Empty means nobody — the safe default, and the normal state of
 * a production instance.
 *
 * This list used to be `OTP_TEST_PHONES`, an *allowlist* that decided who was
 * allowed to sign in at all, because a fixed code plus no SMS provider meant
 * an open door. With real SMS the door is no longer open, and the direction
 * has flipped: an empty list is now the restrictive case, not the permissive
 * one. Same values, opposite meaning — which is exactly why the variable was
 * renamed rather than quietly repurposed. See the startup check below.
 */
export const otpBypassPhones: readonly string[] = (env.OTP_BYPASS_PHONES ?? '')
  .split(',')
  .map((phone) => phone.trim())
  .filter((phone) => phone.length > 0);

/**
 * A config file carried over from before real SMS would silently change
 * meaning: `OTP_TEST_PHONES` restricted sign-in to a handful of numbers, while
 * `OTP_BYPASS_PHONES` grants those numbers an SMS-free shortcut and lets
 * everyone else in. Refusing to start beats booting with the opposite of the
 * intended policy.
 */
if (process.env.OTP_TEST_PHONES !== undefined) {
  throw new Error(
    'OTP_TEST_PHONES no longer exists, and its replacement means the opposite.\n' +
      'It was an allowlist: only those numbers could sign in.\n' +
      'OTP_BYPASS_PHONES is a bypass list: everyone can sign in via real SMS, and\n' +
      'these numbers may additionally use the fixed DEV_OTP_CODE.\n' +
      'Rename it once you have confirmed that is what you want:\n' +
      '  pnpm -F @scoot/api exec wrangler secret put OTP_BYPASS_PHONES\n' +
      '  pnpm -F @scoot/api exec wrangler secret delete OTP_TEST_PHONES',
  );
}

/**
 * Which SMS implementation is live. Explicit `SMS_GATEWAY` wins; otherwise
 * having Eskiz credentials is taken as intent to use them. Local development
 * with no credentials lands on `console`, so `pnpm dev` works out of the box
 * and nobody spends provider credit by accident.
 */
export const smsGatewayName: 'console' | 'eskiz' =
  env.SMS_GATEWAY ?? (env.ESKIZ_EMAIL !== undefined && env.ESKIZ_PASSWORD !== undefined ? 'eskiz' : 'console');

/** Eskiz credentials, narrowed. Null unless the Eskiz gateway is selected. */
export const eskizConfig: { email: string; password: string; from: string } | null = (() => {
  if (smsGatewayName !== 'eskiz') return null;
  const { ESKIZ_EMAIL: email, ESKIZ_PASSWORD: password, ESKIZ_FROM: from } = env;
  if (email === undefined || password === undefined) {
    throw new Error(
      'SMS_GATEWAY=eskiz needs ESKIZ_EMAIL and ESKIZ_PASSWORD.\n' +
        'Both are on the "\u0421\u041c\u0421 \u0448\u043b\u044e\u0437" tab at https://my.eskiz.uz/sms/settings.\n' +
        'The password is a credential — set it as a secret, never as a var:\n' +
        '  pnpm -F @scoot/api exec wrangler secret put ESKIZ_PASSWORD',
    );
  }
  return { email, password, from };
})();

/**
 * Google OAuth client ids accepted as an ID token's `aud`. One per platform
 * (iOS, Android, Web), all three public values.
 */
export const googleClientIds: readonly string[] = (env.GOOGLE_CLIENT_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

/** Google sign-in is available only once at least one client id is configured. */
export const googleAuthEnabled = googleClientIds.length > 0;
