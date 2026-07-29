import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { telegramLoginNonces } from '../db/schema.js';

/**
 * One-time nonces for "login via Telegram" from the native app. Unlike OTP
 * codes these are 32 random bytes — unguessable — so they are stored in plain
 * text. Lifecycle: created → completed (webhook saw /start <nonce>) →
 * consumed (app collected the session).
 */

export interface TelegramLoginNonce {
  id: string;
  userId: string | null;
  completedAt: Date | null;
}

export function createTelegramNoncesRepository(db: Database) {
  return {
    async create(input: { nonce: string; expiresAt: Date }): Promise<void> {
      await db.insert(telegramLoginNonces).values(input);
    },

    /** Unexpired, unconsumed nonce — pending or completed. */
    async findActive(nonce: string): Promise<TelegramLoginNonce | null> {
      const [row] = await db
        .select({
          id: telegramLoginNonces.id,
          userId: telegramLoginNonces.userId,
          completedAt: telegramLoginNonces.completedAt,
        })
        .from(telegramLoginNonces)
        .where(
          and(
            eq(telegramLoginNonces.nonce, nonce),
            isNull(telegramLoginNonces.consumedAt),
            gt(telegramLoginNonces.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    /** The webhook saw /start <nonce> — attach the Telegram identity. */
    async complete(id: string, input: { userId: string; telegramId: number }): Promise<void> {
      await db
        .update(telegramLoginNonces)
        .set({ userId: input.userId, telegramId: input.telegramId, completedAt: new Date() })
        .where(eq(telegramLoginNonces.id, id));
    },

    async consume(id: string): Promise<void> {
      await db
        .update(telegramLoginNonces)
        .set({ consumedAt: new Date() })
        .where(eq(telegramLoginNonces.id, id));
    },

    /** Housekeeping so the table does not grow without bound. */
    async deleteExpired(): Promise<void> {
      await db.delete(telegramLoginNonces).where(lt(telegramLoginNonces.expiresAt, new Date()));
    },
  };
}

export type TelegramNoncesRepository = ReturnType<typeof createTelegramNoncesRepository>;
