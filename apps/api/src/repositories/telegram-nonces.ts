import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { telegramLoginNonces } from '../db/schema.js';

/**
 * One-time nonces for the Telegram flows. Unlike OTP codes these are 32 random
 * bytes — unguessable — so they are stored in plain text.
 *
 * Lifecycle is now two legs, because a rider's number arrives separately from
 * their tap on Start:
 *
 *   created → claimed  (webhook saw /start <nonce>, recorded the chat,
 *                       asked for the contact)
 *           → completed (that chat shared a verified number)
 *           → consumed  (app collected the session)
 *
 * The middle step is why `chatId` exists: the contact message carries no
 * nonce, so it is matched back by the chat that sent it.
 */

export interface TelegramLoginNonce {
  id: string;
  purpose: 'login' | 'link';
  userId: string | null;
  name: string | null;
  phone: string | null;
  completedAt: Date | null;
}

const columns = {
  id: telegramLoginNonces.id,
  purpose: telegramLoginNonces.purpose,
  userId: telegramLoginNonces.userId,
  name: telegramLoginNonces.name,
  phone: telegramLoginNonces.phone,
  completedAt: telegramLoginNonces.completedAt,
} as const;

export function createTelegramNoncesRepository(db: Database) {
  return {
    async create(input: {
      nonce: string;
      expiresAt: Date;
      purpose: 'login' | 'link';
      /** Pre-set for `link`, where we already know whose account this is. */
      userId?: string;
    }): Promise<void> {
      await db.insert(telegramLoginNonces).values(input);
    },

    /** Unexpired, unconsumed nonce — pending or completed. */
    async findActive(nonce: string): Promise<TelegramLoginNonce | null> {
      const [row] = await db
        .select(columns)
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

    /**
     * Leg one: the webhook saw /start <nonce>. Records who tapped it and which
     * chat to expect the number from. Deliberately does **not** complete the
     * nonce — the rider is not signed in until they share a number.
     */
    async claim(
      id: string,
      input: {
        userId: string | null;
        telegramId: number;
        chatId: number;
        name: string | null;
      },
    ): Promise<void> {
      await db
        .update(telegramLoginNonces)
        .set({
          // A `link` nonce already knows its user; never overwrite it.
          ...(input.userId === null ? {} : { userId: input.userId }),
          telegramId: input.telegramId,
          chatId: input.chatId,
          name: input.name,
        })
        .where(eq(telegramLoginNonces.id, id));
    },

    /**
     * The nonce a given chat is currently answering: claimed, not yet
     * completed, still alive. Newest wins, so tapping the deep link twice
     * resolves the attempt the rider is actually looking at.
     */
    async findAwaitingContact(chatId: number): Promise<TelegramLoginNonce | null> {
      const [row] = await db
        .select(columns)
        .from(telegramLoginNonces)
        .where(
          and(
            eq(telegramLoginNonces.chatId, chatId),
            isNull(telegramLoginNonces.completedAt),
            isNull(telegramLoginNonces.consumedAt),
            gt(telegramLoginNonces.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(telegramLoginNonces.createdAt))
        .limit(1);
      return row ?? null;
    },

    /** Leg two: a verified number arrived — the nonce is now redeemable. */
    async complete(id: string, input: { userId: string; phone: string }): Promise<void> {
      await db
        .update(telegramLoginNonces)
        .set({ userId: input.userId, phone: input.phone, completedAt: new Date() })
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
