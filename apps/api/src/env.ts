import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Environment loading and validation. The process refuses to start on invalid
 * config rather than failing later with a confusing runtime error.
 *
 * A single root .env serves the whole monorepo; see .env.example for the
 * documented list of variables.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const rootEnvPath = resolve(repoRoot, '.env');

if (existsSync(rootEnvPath)) {
  loadDotenv({ path: rootEnvPath, quiet: true });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — see .env.example'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters — generate with: openssl rand -hex 32'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  DEV_OTP_CODE: z
    .string()
    .regex(/^\d{6}$/, 'DEV_OTP_CODE must be six digits')
    .default('000000'),
  // Comma-separated E.164 allowlist. Non-empty = only these numbers may sign
  // in — for test builds handed out while there is no SMS provider. Empty =
  // any number (normal behaviour).
  OTP_TEST_PHONES: z.string().default(''),
  SIMULATOR_TICK_MS: z.coerce.number().int().min(250).max(60_000).default(3000),
  SIMULATOR_UNLOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.08),
  VEHICLE_GATEWAY: z.enum(['simulated', 'iot']).default('simulated'),
  // Explicit override for the dev affordances (fixed OTP code, /dev/simulate/*).
  // Unset = derived from NODE_ENV. The pre-release deployment runs with
  // NODE_ENV=production DEV_FEATURES=true: there is no SMS provider yet, so
  // the fixed OTP code is the only way phone login can work.
  DEV_FEATURES: z.enum(['true', 'false']).optional(),
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

/** Telegram login is available only when the bot token is configured. */
export const telegramAuthEnabled = env.TELEGRAM_BOT_TOKEN !== undefined;

/** Parsed OTP_TEST_PHONES. Non-empty = sign-in restricted to these numbers. */
export const otpTestPhones: readonly string[] = env.OTP_TEST_PHONES.split(',')
  .map((phone) => phone.trim())
  .filter((phone) => phone.length > 0);
