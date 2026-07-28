import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { otpCodes } from '../db/schema.js';

/**
 * One-time codes for phone login. Codes are stored hashed, expire, and count
 * failed attempts — the same shape a real SMS integration would need.
 *
 * In development the API accepts a fixed code (DEV_OTP_CODE) without consulting
 * this table, so the demo never depends on an SMS provider.
 */

export interface PendingOtp {
  id: string;
  codeHash: string;
  attempts: number;
}

export function createOtpRepository(db: Database) {
  return {
    async create(input: { phone: string; codeHash: string; expiresAt: Date }): Promise<void> {
      await db.insert(otpCodes).values(input);
    },

    /** Most recent unconsumed, unexpired code for a phone. */
    async findActive(phone: string): Promise<PendingOtp | null> {
      const [row] = await db
        .select({ id: otpCodes.id, codeHash: otpCodes.codeHash, attempts: otpCodes.attempts })
        .from(otpCodes)
        .where(
          and(
            eq(otpCodes.phone, phone),
            isNull(otpCodes.consumedAt),
            gt(otpCodes.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(otpCodes.createdAt))
        .limit(1);
      return row ?? null;
    },

    /** When the newest code for a phone was issued, for rate limiting. */
    async lastIssuedAt(phone: string): Promise<Date | null> {
      const [row] = await db
        .select({ createdAt: otpCodes.createdAt })
        .from(otpCodes)
        .where(eq(otpCodes.phone, phone))
        .orderBy(desc(otpCodes.createdAt))
        .limit(1);
      return row?.createdAt ?? null;
    },

    async recordFailedAttempt(id: string, attempts: number): Promise<void> {
      await db.update(otpCodes).set({ attempts }).where(eq(otpCodes.id, id));
    },

    async consume(id: string): Promise<void> {
      await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, id));
    },

    /** Housekeeping so the table does not grow without bound. */
    async deleteExpired(): Promise<void> {
      await db.delete(otpCodes).where(lt(otpCodes.expiresAt, new Date()));
    },
  };
}

export type OtpRepository = ReturnType<typeof createOtpRepository>;
