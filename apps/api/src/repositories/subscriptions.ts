import { and, desc, eq, gt, sql, type SQL } from 'drizzle-orm';
import type { Subscription, SubscriptionDetail, SubscriptionStatus } from '@scoot/shared';
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
}

const columns = {
  id: subscriptions.id,
  userId: subscriptions.userId,
  vehicleId: subscriptions.vehicleId,
  planId: subscriptions.planId,
  startsAt: subscriptions.startsAt,
  expiresAt: subscriptions.expiresAt,
  status: subscriptions.status,
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
        planDurationDays: plans.durationDays,
        vehicleQrCode: vehicles.qrCode,
        vehicleModel: vehicles.model,
        vehicleStatus: vehicles.status,
        userPhone: users.phone,
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
        durationDays: row.planDurationDays,
      },
      vehicle: {
        id: row.vehicleId,
        qrCode: row.vehicleQrCode,
        model: row.vehicleModel,
        status: row.vehicleStatus,
      },
      userPhone: row.userPhone,
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

    /** Sweeps subscriptions whose window has closed. Returns how many expired. */
    async expireLapsed(): Promise<number> {
      const rows = await db
        .update(subscriptions)
        .set({ status: 'expired' })
        .where(and(eq(subscriptions.status, 'active'), sql`expires_at <= now()`))
        .returning({ id: subscriptions.id });
      return rows.length;
    },

  };
}

export type SubscriptionsRepository = ReturnType<typeof createSubscriptionsRepository>;
