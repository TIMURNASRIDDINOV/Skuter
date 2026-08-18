import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { User } from '@scoot/shared';
import type { Database } from '../db/client.js';
import { rides, users } from '../db/schema.js';
import { toUser, type UserRow } from './mappers.js';

const columns = {
  id: users.id,
  phone: users.phone,
  name: users.name,
  telegramId: users.telegramId,
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
