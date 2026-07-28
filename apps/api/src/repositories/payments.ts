import { desc, eq } from 'drizzle-orm';
import type { Payment, PaymentProviderName, PaymentStatus } from '@scoot/shared';
import type { Database } from '../db/client.js';
import { payments } from '../db/schema.js';
import { toIso } from './mappers.js';

interface PaymentRow {
  id: string;
  userId: string;
  rideId: string | null;
  subscriptionId: string | null;
  amount: number;
  provider: PaymentProviderName;
  providerRef: string | null;
  status: PaymentStatus;
  createdAt: Date;
}

const columns = {
  id: payments.id,
  userId: payments.userId,
  rideId: payments.rideId,
  subscriptionId: payments.subscriptionId,
  amount: payments.amount,
  provider: payments.provider,
  providerRef: payments.providerRef,
  status: payments.status,
  createdAt: payments.createdAt,
} as const;

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    userId: row.userId,
    rideId: row.rideId,
    subscriptionId: row.subscriptionId,
    amount: row.amount,
    provider: row.provider,
    providerRef: row.providerRef,
    status: row.status,
    createdAt: toIso(row.createdAt),
  };
}

export function createPaymentsRepository(db: Database) {
  return {
    /** Records the outcome of a `PaymentProvider.charge`. */
    async record(input: {
      userId: string;
      rideId: string | null;
      subscriptionId: string | null;
      amount: number;
      provider: PaymentProviderName;
      providerRef: string | null;
      status: PaymentStatus;
    }): Promise<Payment> {
      const [row] = await db.insert(payments).values(input).returning(columns);
      if (row === undefined) throw new Error('Failed to record payment');
      return toPayment(row as PaymentRow);
    },

    async listForUser(userId: string, limit = 50): Promise<Payment[]> {
      const rows = await db
        .select(columns)
        .from(payments)
        .where(eq(payments.userId, userId))
        .orderBy(desc(payments.createdAt))
        .limit(limit);
      return rows.map((row) => toPayment(row as PaymentRow));
    },

    async listAll(limit = 200): Promise<Payment[]> {
      const rows = await db
        .select(columns)
        .from(payments)
        .orderBy(desc(payments.createdAt))
        .limit(limit);
      return rows.map((row) => toPayment(row as PaymentRow));
    },
  };
}

export type PaymentsRepository = ReturnType<typeof createPaymentsRepository>;
