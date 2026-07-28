import { and, desc, eq } from 'drizzle-orm';
import type { Admin, AdminRole, AuditLogRow, ListAuditLogQuery } from '@scoot/shared';
import type { Database } from '../db/client.js';
import { admins, auditLog } from '../db/schema.js';
import { toAdmin, toAuditLogRow, type AdminRow, type AuditLogRowRaw } from './mappers.js';

const columns = {
  id: admins.id,
  email: admins.email,
  role: admins.role,
} as const;

export interface NewAdmin {
  email: string;
  passwordHash: string;
  role: AdminRole;
}

export function createAdminsRepository(db: Database) {
  return {
    async findById(id: string): Promise<Admin | null> {
      const [row] = await db.select(columns).from(admins).where(eq(admins.id, id)).limit(1);
      return row === undefined ? null : toAdmin(row as AdminRow);
    },

    /** Includes the password hash — only the login route may call this. */
    async findByEmailWithHash(
      email: string,
    ): Promise<{ admin: Admin; passwordHash: string } | null> {
      const [row] = await db
        .select({ ...columns, passwordHash: admins.passwordHash })
        .from(admins)
        .where(eq(admins.email, email.toLowerCase()))
        .limit(1);
      if (row === undefined) return null;
      return { admin: toAdmin(row as AdminRow), passwordHash: row.passwordHash };
    },

    async insertMany(items: readonly NewAdmin[]): Promise<void> {
      if (items.length === 0) return;
      await db.insert(admins).values(items.map((i) => ({ ...i, email: i.email.toLowerCase() })));
    },

    async deleteAll(): Promise<void> {
      await db.delete(admins);
    },
  };
}

export interface NewAuditEntry {
  adminId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  payload: unknown;
}

export function createAuditRepository(db: Database) {
  return {
    async append(entry: NewAuditEntry): Promise<void> {
      await db.insert(auditLog).values({
        adminId: entry.adminId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        payload: entry.payload,
      });
    },

    async list(query: ListAuditLogQuery = {}, limit = 100, offset = 0): Promise<AuditLogRow[]> {
      const filters = [];
      if (query.entity !== undefined) filters.push(eq(auditLog.entity, query.entity));
      if (query.action !== undefined) filters.push(eq(auditLog.action, query.action));
      if (query.adminId !== undefined) filters.push(eq(auditLog.adminId, query.adminId));

      const rows = await db
        .select({
          id: auditLog.id,
          adminId: auditLog.adminId,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          payload: auditLog.payload,
          createdAt: auditLog.createdAt,
          adminEmail: admins.email,
        })
        .from(auditLog)
        .leftJoin(admins, eq(auditLog.adminId, admins.id))
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset);

      return rows.map((row) => toAuditLogRow(row as AuditLogRowRaw));
    },
  };
}

export type AdminsRepository = ReturnType<typeof createAdminsRepository>;
export type AuditRepository = ReturnType<typeof createAuditRepository>;
