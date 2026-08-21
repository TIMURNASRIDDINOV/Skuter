import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { User } from '@ozothunder/shared';
import type { Database } from '../db/client.js';
import { rides, users } from '../db/schema.js';
import { toUser, type UserRow } from './mappers.js';

const columns = {
  id: users.id,
  phone: users.phone,
  name: users.name,
  telegramId: users.telegramId,
  email: users.email,
  status: users.status,
  balance: users.balance,
  createdAt: users.createdAt,
} as const;

export interface NewUser {
  phone: string | null;
  name: string | null;
  balance: number;
  telegramId?: number;
}

export interface GoogleIdentity {
  /** Google's `sub` claim — the only key a Google login matches on. */
  googleSub: string;
  email: string;
  name: string | null;
}

export function createUsersRepository(db: Database) {
  return {
    async listAll(): Promise<User[]> {
      const rows = await db.select(columns).from(users).orderBy(asc(users.createdAt));
      return rows.map((row) => toUser(row as UserRow));
    },

    /**
     * Active riders with no ride in flight, in one statement.
     *
     * The simulator needs a free account to hang a forced ride on. Doing that
     * as `listAll()` plus a `findActiveByUser` per user is a round-trip per
     * rider to answer a question Postgres can answer once.
     */
    async listIdle(): Promise<User[]> {
      const rows = await db
        .select(columns)
        .from(users)
        .where(
          and(
            eq(users.status, 'active'),
            sql`NOT EXISTS (
              SELECT 1 FROM ${rides}
              WHERE ${rides.userId} = ${users.id} AND ${rides.status} = 'active'
            )`,
          ),
        )
        .orderBy(asc(users.createdAt));
      return rows.map((row) => toUser(row as UserRow));
    },

    async findById(id: string): Promise<User | null> {
      const [row] = await db.select(columns).from(users).where(eq(users.id, id)).limit(1);
      return row === undefined ? null : toUser(row as UserRow);
    },

    async findByPhone(phone: string): Promise<User | null> {
      const [row] = await db.select(columns).from(users).where(eq(users.phone, phone)).limit(1);
      return row === undefined ? null : toUser(row as UserRow);
    },

    /** Riders are created on their first successful OTP verification. */
    async findOrCreateByPhone(phone: string): Promise<User> {
      const existing = await this.findByPhone(phone);
      if (existing !== null) return existing;

      const [row] = await db
        .insert(users)
        .values({ phone })
        .onConflictDoNothing({ target: users.phone })
        .returning(columns);

      // A concurrent verify for the same phone can win the insert; re-read.
      if (row === undefined) {
        const raced = await this.findByPhone(phone);
        if (raced === null) throw new Error(`Failed to create or find user for ${phone}`);
        return raced;
      }
      return toUser(row as UserRow);
    },

    async findByTelegramId(telegramId: number): Promise<User | null> {
      const [row] = await db
        .select(columns)
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
      return row === undefined ? null : toUser(row as UserRow);
    },

    /** Riders are created on their first Telegram login — no phone yet. */
    async findOrCreateByTelegram(telegramId: number, name: string | null): Promise<User> {
      const existing = await this.findByTelegramId(telegramId);
      if (existing !== null) return existing;

      const [row] = await db
        .insert(users)
        .values({ phone: null, telegramId, name })
        .onConflictDoNothing({ target: users.telegramId })
        .returning(columns);

      // A concurrent login for the same Telegram account can win; re-read.
      if (row === undefined) {
        const raced = await this.findByTelegramId(telegramId);
        if (raced === null) throw new Error(`Failed to create or find user for tg:${telegramId}`);
        return raced;
      }
      return toUser(row as UserRow);
    },

    async findByGoogleSub(googleSub: string): Promise<User | null> {
      const [row] = await db
        .select(columns)
        .from(users)
        .where(eq(users.googleSub, googleSub))
        .limit(1);
      return row === undefined ? null : toUser(row as UserRow);
    },

    /**
     * Riders are created on their first Google login — no phone yet, which the
     * ride gate makes them supply before they can unlock anything.
     *
     * Matching is on `googleSub` alone. Adopting an existing account because
     * its email matches would mean anyone able to create a Google account at a
     * rider's address could take the account over, so a Google login that does
     * not know a `sub` we have seen always becomes a new rider.
     */
    async findOrCreateByGoogle(identity: GoogleIdentity): Promise<User> {
      const existing = await this.findByGoogleSub(identity.googleSub);
      if (existing !== null) return existing;

      const [row] = await db
        .insert(users)
        .values({
          phone: null,
          googleSub: identity.googleSub,
          email: identity.email,
          name: identity.name,
        })
        .onConflictDoNothing({ target: users.googleSub })
        .returning(columns);

      // A concurrent login for the same Google account can win; re-read.
      if (row === undefined) {
        const raced = await this.findByGoogleSub(identity.googleSub);
        if (raced === null) {
          throw new Error(`Failed to create or find user for google:${identity.googleSub}`);
        }
        return raced;
      }
      return toUser(row as UserRow);
    },

    /**
     * Attaches a verified phone to an account that signed up through Telegram
     * or Google. Returns null when the number already belongs to somebody else
     * — `users_phone_key` would reject it, and the caller says so plainly
     * rather than surfacing a constraint violation.
     */
    async linkPhone(id: string, phone: string): Promise<User | null> {
      const taken = await this.findByPhone(phone);
      if (taken !== null && taken.id !== id) return null;

      const [row] = await db
        .update(users)
        .set({ phone })
        .where(eq(users.id, id))
        .returning(columns);
      return row === undefined ? null : toUser(row as UserRow);
    },

    /**
     * Resolve the rider behind a Telegram account that has just shared a
     * verified number, creating one only if neither identifier is known.
     *
     * Order matters. Matching the Telegram id first keeps a returning rider on
     * their own account. Falling back to the **phone** is what stops a second,
     * orphaned account appearing for somebody who linked this number to a
     * Google sign-up earlier and then tapped "Continue with Telegram" — the
     * number is verified by Telegram, so it is proof of the same person, and
     * the two identities are merged onto the existing account rather than
     * dead-ending on "this number belongs to someone else".
     *
     * This is deliberately unlike the Google path, which matches on `sub` and
     * never on email: an email is only asserted, a shared contact is proven.
     */
    async findOrCreateForTelegramContact(input: {
      telegramId: number;
      name: string | null;
      phone: string;
    }): Promise<User | null> {
      const byTelegram = await this.findByTelegramId(input.telegramId);
      if (byTelegram !== null) {
        return byTelegram.phone === input.phone
          ? byTelegram
          : await this.linkPhone(byTelegram.id, input.phone);
      }

      const byPhone = await this.findByPhone(input.phone);
      if (byPhone !== null) {
        // Known number, new Telegram account — adopt the identity so next
        // time the first lookup hits.
        const [row] = await db
          .update(users)
          .set({ telegramId: input.telegramId })
          .where(and(eq(users.id, byPhone.id), sql`${users.telegramId} IS NULL`))
          .returning(columns);
        return row === undefined ? byPhone : toUser(row as UserRow);
      }

      const created = await this.findOrCreateByTelegram(input.telegramId, input.name);
      return await this.linkPhone(created.id, input.phone);
    },

    async updateName(id: string, name: string | null): Promise<User | null> {
      const [row] = await db.update(users).set({ name }).where(eq(users.id, id)).returning(columns);
      return row === undefined ? null : toUser(row as UserRow);
    },

    async count(): Promise<number> {
      const [row] = await db.select({ total: count() }).from(users);
      return row?.total ?? 0;
    },

    async insertMany(items: readonly NewUser[]): Promise<void> {
      if (items.length === 0) return;
      await db.insert(users).values([...items]);
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
