import { and, count, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { otpCodes } from '../db/schema.js';

/**
 * One-time codes for phone login. Codes are stored hashed, expire, and count
 * failed attempts.
 *
 * This table doubles as the rate-limit ledger. Every issued code is a row with
 * a phone, an IP and a timestamp, which is all the counters below need — real
 * SMS costs money per message, so "how many did this number/address ask for
 * lately" has to be answerable before another one goes out.
 *
 * Numbers in OTP_BYPASS_PHONES are verified against the fixed DEV_OTP_CODE
 * without consulting this table, so a rehearsed demo never waits on a carrier.
 */

export interface PendingOtp {
  id: string;
  codeHash: string;
  attempts: number;
}

export function createOtpRepository(db: Database) {
  return {
    async create(input: {
      phone: string;
      codeHash: string;
      expiresAt: Date;
      requestIp: string | null;
    }): Promise<void> {
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

    /** Codes issued to a phone since `since` — the per-number daily cap. */
    async countRecentByPhone(phone: string, since: Date): Promise<number> {
      const [row] = await db
        .select({ total: count() })
        .from(otpCodes)
        .where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, since)));
      return row?.total ?? 0;
    },

    /**
     * Codes issued from one address since `since` — the per-IP cap, which is
     * what stops someone cycling through numbers to burn the SMS balance.
     */
    async countRecentByIp(ip: string, since: Date): Promise<number> {
      const [row] = await db
        .select({ total: count() })
        .from(otpCodes)
        .where(and(eq(otpCodes.requestIp, ip), gt(otpCodes.createdAt, since)));
      return row?.total ?? 0;
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
