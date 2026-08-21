import { asc, eq } from 'drizzle-orm';
import type { Plan, PlanKind } from '@ozothunder/shared';
import type { Database } from '../db/client.js';
import { plans } from '../db/schema.js';
import { toPlan, type PlanRow } from './mappers.js';

const columns = {
  id: plans.id,
  kind: plans.kind,
  name: plans.name,
  unlockFee: plans.unlockFee,
  price: plans.price,
  durationDays: plans.durationDays,
} as const;

export interface NewPlan {
  kind: PlanKind;
  name: string;
  unlockFee: number;
  price: number;
  durationDays: number | null;
}

export function createPlansRepository(db: Database) {
  return {
    async listActive(): Promise<Plan[]> {
      const rows = await db
        .select(columns)
        .from(plans)
        .where(eq(plans.active, true))
        .orderBy(asc(plans.price));
      return rows.map((row) => toPlan(row as PlanRow));
    },

    async listAll(): Promise<Plan[]> {
      const rows = await db.select(columns).from(plans).orderBy(asc(plans.price));
      return rows.map((row) => toPlan(row as PlanRow));
    },

    async findById(id: string): Promise<Plan | null> {
      const [row] = await db.select(columns).from(plans).where(eq(plans.id, id)).limit(1);
      return row === undefined ? null : toPlan(row as PlanRow);
    },

    async findByKind(kind: PlanKind): Promise<Plan | null> {
      const [row] = await db.select(columns).from(plans).where(eq(plans.kind, kind)).limit(1);
      return row === undefined ? null : toPlan(row as PlanRow);
    },

    async update(id: string, patch: Partial<NewPlan>): Promise<Plan | null> {
      const [row] = await db.update(plans).set(patch).where(eq(plans.id, id)).returning(columns);
      return row === undefined ? null : toPlan(row as PlanRow);
    },

    async insertMany(items: readonly NewPlan[]): Promise<Plan[]> {
      if (items.length === 0) return [];
      const rows = await db
        .insert(plans)
        .values([...items])
        .returning(columns);
      return rows.map((row) => toPlan(row as PlanRow));
    },

    async deleteAll(): Promise<void> {
      await db.delete(plans);
    },
  };
}

export type PlansRepository = ReturnType<typeof createPlansRepository>;
