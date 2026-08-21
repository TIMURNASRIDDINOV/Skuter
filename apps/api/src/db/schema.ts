import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { lineString4326, point4326, polygon4326 } from './types.js';

/**
 * Database schema. This file and the repositories under ../repositories are
 * the only places that know about Drizzle; everything else in the API talks
 * to repositories. Moving to Supabase means changing DATABASE_URL, nothing here.
 *
 * Conventions:
 * - Money is integer **tiyin** in `bigint` (mode: 'number'). `integer` would
 *   cap at ~21.5M so'm, too tight for a wallet balance.
 * - Timestamps are `timestamptz`, always stored UTC. Asia/Samarkand is applied
 *   at display time only.
 * - Every geometry column carries a GIST index; the geofence queries in
 *   Checkpoint 3 (ST_Contains / ST_DWithin) depend on them.
 */

// --- enums ---------------------------------------------------------------

export const vehicleStatusEnum = pgEnum('vehicle_status', [
  'available',
  'in_use',
  'reserved',
  'offline',
  'low_battery',
  'maintenance',
]);

export const userStatusEnum = pgEnum('user_status', ['active', 'blocked']);

export const zoneKindEnum = pgEnum('zone_kind', ['service', 'parking', 'forbidden', 'slow']);

export const planKindEnum = pgEnum('plan_kind', ['per_minute', 'daily', 'weekly']);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'expired',
  'cancelled',
]);

export const rideStatusEnum = pgEnum('ride_status', ['active', 'completed', 'cancelled']);

export const commandTypeEnum = pgEnum('command_type', ['unlock', 'lock', 'beep', 'locate']);

export const commandStatusEnum = pgEnum('command_status', ['pending', 'sent', 'acked', 'failed']);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
]);

export const paymentProviderEnum = pgEnum('payment_provider', ['mock', 'payme', 'click', 'uzum']);

export const adminRoleEnum = pgEnum('admin_role', ['owner', 'operator', 'viewer']);

/** `login` signs a rider in; `link` attaches a number to an existing account. */
export const telegramNoncePurposeEnum = pgEnum('telegram_nonce_purpose', ['login', 'link']);

// --- tables --------------------------------------------------------------

export const areas = pgTable(
  'areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    geom: polygon4326('geom').notNull(),
  },
  (t) => [index('areas_geom_idx').using('gist', t.geom)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for accounts created via Telegram login — no phone known yet. */
    phone: text('phone'),
    name: text('name'),
    /** Telegram account id for users who signed in via the bot / mini app. */
    telegramId: bigint('telegram_id', { mode: 'number' }),
    /**
     * Google's `sub` claim — stable per account, and the *only* key a Google
     * login matches on. Matching on email instead would let anyone who can
     * receive mail at a rider's address take over the account.
     */
    googleSub: text('google_sub'),
    /** Google account email. Display and support only; never a match key. */
    email: text('email'),
    status: userStatusEnum('status').notNull().default('active'),
    /** Wallet balance in tiyin. */
    balance: bigint('balance', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_phone_key').on(t.phone),
    uniqueIndex('users_telegram_id_key').on(t.telegramId),
    uniqueIndex('users_google_sub_key').on(t.googleSub),
    uniqueIndex('users_email_key').on(t.email),
  ],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Printed on the sticker, e.g. 000000042. */
    qrCode: text('qr_code').notNull(),
    imei: text('imei').notNull(),
    model: text('model').notNull(),
    status: vehicleStatusEnum('status').notNull().default('available'),
    batteryPct: smallint('battery_pct').notNull().default(100),
    geom: point4326('geom').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    areaId: uuid('area_id').references(() => areas.id, { onDelete: 'set null' }),
    /**
     * Reservation hold. Both columns move together — a vehicle is held when
     * `reservedUntil` is in the future, and `reservedBy` says whose hold it is
     * so another rider cannot unlock it.
     *
     * `set null` on user delete rather than cascade: losing an account should
     * free the scooter, not delete it.
     */
    reservedUntil: timestamp('reserved_until', { withTimezone: true }),
    reservedBy: uuid('reserved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('vehicles_qr_code_key').on(t.qrCode),
    uniqueIndex('vehicles_imei_key').on(t.imei),
    index('vehicles_geom_idx').using('gist', t.geom),
    index('vehicles_status_idx').on(t.status),
    // Drives the expiry sweep, which runs on every public vehicle list.
    index('vehicles_reserved_until_idx').on(t.reservedUntil),
  ],
);

export const zones = pgTable(
  'zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: zoneKindEnum('kind').notNull(),
    geom: polygon4326('geom').notNull(),
    areaId: uuid('area_id').references(() => areas.id, { onDelete: 'cascade' }),
    /** Only set on `slow` zones; null on every other kind. */
    speedLimitKph: smallint('speed_limit_kph'),
  },
  (t) => [index('zones_geom_idx').using('gist', t.geom), index('zones_kind_idx').on(t.kind)],
);

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: planKindEnum('kind').notNull(),
  name: text('name').notNull(),
  /** One-off unlock fee in tiyin. */
  unlockFee: bigint('unlock_fee', { mode: 'number' }).notNull().default(0),
  /** Per-minute rate (per_minute) or total plan price (daily/weekly), tiyin. */
  price: bigint('price', { mode: 'number' }).notNull(),
  /** Null for per_minute plans. */
  durationDays: integer('duration_days'),
  active: boolean('active').notNull().default(true),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** A subscription binds the rider to one specific vehicle. */
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: subscriptionStatusEnum('status').notNull().default('active'),
  },
  (t) => [
    index('subscriptions_user_idx').on(t.userId),
    index('subscriptions_vehicle_idx').on(t.vehicleId),
    index('subscriptions_status_idx').on(t.status),
    // At most one active subscription per vehicle at a time.
    uniqueIndex('subscriptions_active_vehicle_key')
      .on(t.vehicleId)
      .where(sql`status = 'active'`),
  ],
);

export const rides = pgTable(
  'rides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Travelled path; null until the ride has at least two points. */
    path: lineString4326('path'),
    distanceM: integer('distance_m').notNull().default(0),
    durationS: integer('duration_s').notNull().default(0),
    /** Total charged in tiyin. */
    cost: bigint('cost', { mode: 'number' }).notNull().default(0),
    endZoneId: uuid('end_zone_id').references(() => zones.id, { onDelete: 'set null' }),
    status: rideStatusEnum('status').notNull().default('active'),
  },
  (t) => [
    index('rides_user_idx').on(t.userId),
    index('rides_vehicle_idx').on(t.vehicleId),
    index('rides_status_idx').on(t.status),
    index('rides_started_at_idx').on(t.startedAt),
    index('rides_path_idx').using('gist', t.path),
    // A rider may only have one ride in flight.
    uniqueIndex('rides_active_user_key')
      .on(t.userId)
      .where(sql`status = 'active'`),
  ],
);

export const commands = pgTable(
  'commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    type: commandTypeEnum('type').notNull(),
    status: commandStatusEnum('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    /** Why the command failed, when status is 'failed'. */
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('commands_vehicle_idx').on(t.vehicleId),
    index('commands_status_idx').on(t.status),
    index('commands_created_at_idx').on(t.createdAt),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rideId: uuid('ride_id').references(() => rides.id, { onDelete: 'set null' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    /** Charged amount in tiyin. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    provider: paymentProviderEnum('provider').notNull().default('mock'),
    providerRef: text('provider_ref'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_user_idx').on(t.userId),
    index('payments_status_idx').on(t.status),
    index('payments_created_at_idx').on(t.createdAt),
  ],
);

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: adminRoleEnum('role').notNull().default('operator'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('admins_email_key').on(t.email)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id').references(() => admins.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity),
    index('audit_log_created_at_idx').on(t.createdAt),
  ],
);

/**
 * Phone OTP codes. Not in the original data model, but the specced phone-OTP
 * auth needs somewhere to keep a hashed code with an expiry and an attempt
 * counter. In development a fixed code is accepted and no row is required.
 */
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /**
     * Who asked. Null for codes issued before this column existed, and for
     * callers behind a proxy that strips the header. Real SMS costs money, so
     * the per-IP cap in routes/auth.ts counts rows by this.
     */
    requestIp: text('request_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('otp_codes_phone_idx').on(t.phone),
    index('otp_codes_expires_idx').on(t.expiresAt),
    index('otp_codes_ip_created_idx').on(t.requestIp, t.createdAt),
  ],
);

/**
 * One-time nonces for the Telegram flows in the native app. The app opens
 * t.me/<bot>?start=<nonce>; the bot webhook fills in the Telegram identity and
 * asks for the user's number; the app polls until the nonce completes, then it
 * is consumed. Nonces are 32 random bytes — unguessable, so stored in plain
 * text (unlike OTP codes).
 *
 * Two purposes share the mechanism. `login` signs a rider in and attaches the
 * number Telegram vouches for; `link` attaches a number to an account that
 * already exists (a Google sign-up), so `user_id` is set at creation instead of
 * by the webhook.
 *
 * `chat_id` is what makes the second leg work: the shared contact arrives as a
 * plain message with **no nonce in it**, so the webhook has to find the nonce
 * this chat is currently answering.
 */
export const telegramLoginNonces = pgTable(
  'telegram_login_nonces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nonce: text('nonce').notNull(),
    purpose: telegramNoncePurposeEnum('purpose').notNull().default('login'),
    /** Set by the webhook for `login`; set at creation for `link`. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    telegramId: bigint('telegram_id', { mode: 'number' }),
    /** The chat that tapped Start, so its later contact message finds us. */
    chatId: bigint('chat_id', { mode: 'number' }),
    /** Display name seen at Start, used only if a new rider is created. */
    name: text('name'),
    /** The verified number Telegram handed over, E.164. */
    phone: text('phone'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('telegram_login_nonces_nonce_key').on(t.nonce),
    index('telegram_login_nonces_expires_idx').on(t.expiresAt),
    index('telegram_login_nonces_chat_idx').on(t.chatId, t.createdAt),
  ],
);

// --- relations -----------------------------------------------------------

export const areasRelations = relations(areas, ({ many }) => ({
  vehicles: many(vehicles),
  zones: many(zones),
}));

export const usersRelations = relations(users, ({ many }) => ({
  rides: many(rides),
  subscriptions: many(subscriptions),
  payments: many(payments),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  area: one(areas, { fields: [vehicles.areaId], references: [areas.id] }),
  rides: many(rides),
  commands: many(commands),
  subscriptions: many(subscriptions),
}));

export const zonesRelations = relations(zones, ({ one }) => ({
  area: one(areas, { fields: [zones.areaId], references: [areas.id] }),
}));

export const plansRelations = relations(plans, ({ many }) => ({
  subscriptions: many(subscriptions),
  rides: many(rides),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
  vehicle: one(vehicles, { fields: [subscriptions.vehicleId], references: [vehicles.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
}));

export const ridesRelations = relations(rides, ({ one }) => ({
  user: one(users, { fields: [rides.userId], references: [users.id] }),
  vehicle: one(vehicles, { fields: [rides.vehicleId], references: [vehicles.id] }),
  plan: one(plans, { fields: [rides.planId], references: [plans.id] }),
  endZone: one(zones, { fields: [rides.endZoneId], references: [zones.id] }),
}));

export const commandsRelations = relations(commands, ({ one }) => ({
  vehicle: one(vehicles, { fields: [commands.vehicleId], references: [vehicles.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] }),
  ride: one(rides, { fields: [payments.rideId], references: [rides.id] }),
  subscription: one(subscriptions, {
    fields: [payments.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  admin: one(admins, { fields: [auditLog.adminId], references: [admins.id] }),
}));
