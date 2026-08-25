import { and, desc, eq, gt, sql, type SQL } from 'drizzle-orm';
import type { Subscription, SubscriptionDetail, SubscriptionStatus } from '@ozothunder/shared';
import type { Database } from '../db/client.js';
import { plans, subscriptions, users, vehicles } from '../db/schema.js';
import { toIso } from './mappers.js';

interface SubscriptionRow {
  id: string;
  userId: string;
  vehicleId: string;
  planId: string;
  startsAt: Date;
  expiresAt: Date;
  status: SubscriptionStatus;
  unlockedAt: Date | null;
}

const columns = {
  id: subscriptions.id,
  userId: subscriptions.userId,
  vehicleId: subscriptions.vehicleId,
  planId: subscriptions.planId,
  startsAt: subscriptions.startsAt,
  expiresAt: subscriptions.expiresAt,
  status: subscriptions.status,
  unlockedAt: subscriptions.unlockedAt,
} as const;

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.userId,
    vehicleId: row.vehicleId,
    planId: row.planId,
    startsAt: toIso(row.startsAt),
    expiresAt: toIso(row.expiresAt),
    status: row.status,
    unlockedAt: row.unlockedAt === null ? null : toIso(row.unlockedAt),
  };
}

export function createSubscriptionsRepository(db: Database) {
  async function listDetailed(where: SQL | undefined): Promise<SubscriptionDetail[]> {
    const rows = await db
      .select({
        ...columns,
        planKind: plans.kind,
        planName: plans.name,
        planUnlockFee: plans.unlockFee,
        planPrice: plans.price,
        planDurationMinutes: plans.durationMinutes,
        planOfficeOnly: plans.officeOnly,
        planActive: plans.active,
        vehicleQrCode: vehicles.qrCode,
        vehicleModel: vehicles.model,
        vehicleStatus: vehicles.status,
        userPhone: users.phone,
        userName: users.name,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .innerJoin(vehicles, eq(subscriptions.vehicleId, vehicles.id))
      .innerJoin(users, eq(subscriptions.userId, users.id))
      .where(where)
      .orderBy(desc(subscriptions.startsAt));

    return rows.map((row) => ({
      ...toSubscription(row as SubscriptionRow),
      plan: {
        id: row.planId,
        kind: row.planKind,
        name: row.planName,
        unlockFee: row.planUnlockFee,
        price: row.planPrice,
        durationMinutes: row.planDurationMinutes,
        officeOnly: row.planOfficeOnly,
        active: row.planActive,
      },
      vehicle: {
        id: row.vehicleId,
        qrCode: row.vehicleQrCode,
        model: row.vehicleModel,
        status: row.vehicleStatus,
      },
      userPhone: row.userPhone,
      userName: row.userName,
    }));
  }

  return {
    async create(input: {
      userId: string;
      vehicleId: string;
      planId: string;
      startsAt: Date;
      expiresAt: Date;
    }): Promise<Subscription> {
      const [row] = await db.insert(subscriptions).values(input).returning(columns);
      if (row === undefined) throw new Error('Failed to create subscription');
      return toSubscription(row as SubscriptionRow);
    },

    async findById(id: string): Promise<Subscription | null> {
      const [row] = await db
        .select(columns)
        .from(subscriptions)
        .where(eq(subscriptions.id, id))
        .limit(1);
      return row === undefined ? null : toSubscription(row as SubscriptionRow);
    },

    /** The live subscription binding a vehicle, if any. */
    async findActiveForVehicle(vehicleId: string): Promise<Subscription | null> {
      const [row] = await db
        .select(columns)
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.vehicleId, vehicleId),
            eq(subscriptions.status, 'active'),
            gt(subscriptions.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return row === undefined ? null : toSubscription(row as SubscriptionRow);
    },

    /** Whether this rider currently has this vehicle on subscription. */
    async findActiveForUserAndVehicle(
      userId: string,
      vehicleId: string,
    ): Promise<Subscription | null> {
      const [row] = await db
        .select(columns)
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, userId),
            eq(subscriptions.vehicleId, vehicleId),
            eq(subscriptions.status, 'active'),
            gt(subscriptions.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return row === undefined ? null : toSubscription(row as SubscriptionRow);
    },

    /**
     * The rider's one live subscription, newest first.
     *
     * `grantSubscription` and `purchaseSubscription` both refuse a second one,
     * so in practice there is at most a single row here — the ordering is what
     * makes that assumption safe rather than merely likely.
     */
    async findActiveForUser(userId: string): Promise<Subscription | null> {
      const [row] = await db
        .select(columns)
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, userId),
            eq(subscriptions.status, 'active'),
            gt(subscriptions.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(subscriptions.startsAt))
        .limit(1);
      return row === undefined ? null : toSubscription(row as SubscriptionRow);
    },

    /** Records the rental being switched on (a date) or off (null). */
    async setUnlocked(id: string, at: Date | null): Promise<Subscription | null> {
      const [row] = await db
        .update(subscriptions)
        .set({ unlockedAt: at })
        .where(eq(subscriptions.id, id))
        .returning(columns);
      return row === undefined ? null : toSubscription(row as SubscriptionRow);
    },

    /** Ends a subscription early. Returns null if it was not active. */
    async cancel(id: string): Promise<Subscription | null> {
      const [row] = await db
        .update(subscriptions)
        .set({ status: 'cancelled' })
        .where(and(eq(subscriptions.id, id), eq(subscriptions.status, 'active')))
        .returning(columns);
      return row === undefined ? null : toSubscription(row as SubscriptionRow);
    },

    async listForUser(userId: string): Promise<SubscriptionDetail[]> {
      return listDetailed(eq(subscriptions.userId, userId));
    },

    async listAll(): Promise<SubscriptionDetail[]> {
      return listDetailed(undefined);
    },

    async countActive(): Promise<number> {
      const result = await db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM subscriptions WHERE status = 'active' AND expires_at > now()`,
      );
      return result.rows[0]?.total ?? 0;
    },

    /**
     * Sweeps subscriptions whose window has closed.
     *
     * Returns the rows rather than a count: each one leaves a vehicle sitting
     * `reserved` that has to be handed back to the fleet, and the caller needs
     * its id to do that.
     */
    async expireLapsed(): Promise<Subscription[]> {
      const rows = await db
        .update(subscriptions)
        .set({ status: 'expired' })
        .where(and(eq(subscriptions.status, 'active'), sql`expires_at <= now()`))
        .returning(columns);
      return rows.map((row) => toSubscription(row as SubscriptionRow));
    },

  };
}

export type SubscriptionsRepository = ReturnType<typeof createSubscriptionsRepository>;
