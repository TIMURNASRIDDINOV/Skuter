import { desc, eq } from 'drizzle-orm';
import type { Command, CommandStatus, CommandType } from '@scoot/shared';
import type { Database } from '../db/client.js';
import { commands } from '../db/schema.js';
import { toIsoOrNull } from './mappers.js';

interface CommandRow {
  id: string;
  vehicleId: string;
  type: CommandType;
  status: CommandStatus;
  sentAt: Date | null;
  ackedAt: Date | null;
}

const columns = {
  id: commands.id,
  vehicleId: commands.vehicleId,
  type: commands.type,
  status: commands.status,
  sentAt: commands.sentAt,
  ackedAt: commands.ackedAt,
} as const;

function toCommand(row: CommandRow): Command {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    type: row.type,
    status: row.status,
    sentAt: toIsoOrNull(row.sentAt),
    ackedAt: toIsoOrNull(row.ackedAt),
  };
}

export function createCommandsRepository(db: Database) {
  return {
    /** Records a command as dispatched; the gateway settles it afterwards. */
    async open(vehicleId: string, type: CommandType): Promise<string> {
      const [row] = await db
        .insert(commands)
        .values({ vehicleId, type, status: 'sent', sentAt: new Date() })
        .returning({ id: commands.id });
      if (row === undefined) throw new Error('Failed to record command');
      return row.id;
    },

    async settle(
      id: string,
      outcome: { status: Extract<CommandStatus, 'acked' | 'failed'>; failureReason: string | null },
    ): Promise<void> {
      await db
        .update(commands)
        .set({
          status: outcome.status,
          ackedAt: new Date(),
          failureReason: outcome.failureReason,
        })
        .where(eq(commands.id, id));
    },

    async listRecent(limit = 50): Promise<Command[]> {
      const rows = await db
        .select(columns)
        .from(commands)
        .orderBy(desc(commands.createdAt))
        .limit(limit);
      return rows.map((row) => toCommand(row as CommandRow));
    },

    async listForVehicle(vehicleId: string, limit = 20): Promise<Command[]> {
      const rows = await db
        .select(columns)
        .from(commands)
        .where(eq(commands.vehicleId, vehicleId))
        .orderBy(desc(commands.createdAt))
        .limit(limit);
      return rows.map((row) => toCommand(row as CommandRow));
    },
  };
}

export type CommandsRepository = ReturnType<typeof createCommandsRepository>;
