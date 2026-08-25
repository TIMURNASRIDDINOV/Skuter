-- Hand-ordered rather than left as drizzle-kit emitted it: this migration both
-- adds columns and narrows two enums whose old values still exist in the table,
-- so the backfills have to run between the two halves. Generated order would
-- have cast 'weekly' to a plan_kind that no longer has it.

--> plans: rental length moves to minutes, and "sold at the desk" becomes its own fact
ALTER TABLE "plans" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "office_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "plans" SET "duration_minutes" = "duration_days" * 1440 WHERE "duration_days" IS NOT NULL;--> statement-breakpoint
UPDATE "plans" SET "office_only" = true WHERE "kind" = 'weekly';--> statement-breakpoint

--> vehicles: the simulator now drives only what is explicitly handed to it.
--> Everything already in the table came from the old seeded fleet, so it keeps
--> moving; anything added from the back office after this is real and stays put.
ALTER TABLE "vehicles" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "vehicles" SET "simulated" = true;--> statement-breakpoint

--> admins: per-section permissions, and two roles instead of three
ALTER TABLE "admins" ADD COLUMN "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "admins" SET "permissions" = '{"dashboard":"manage","vehicles":"manage","rides":"manage","subscriptions":"manage","users":"manage","plans":"manage","zones":"manage","audit":"view"}'::jsonb WHERE "role" = 'operator';--> statement-breakpoint
UPDATE "admins" SET "permissions" = '{"dashboard":"view","vehicles":"view","rides":"view","subscriptions":"view","users":"view","plans":"view","zones":"view","audit":"view"}'::jsonb WHERE "role" = 'viewer';--> statement-breakpoint

--> plan_kind: 'daily' and 'weekly' collapse into 'rental' — how long a rental
--> runs is duration_minutes, and it was never the enum's business
ALTER TABLE "plans" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
UPDATE "plans" SET "kind" = 'rental' WHERE "kind" IN ('daily', 'weekly');--> statement-breakpoint
DROP TYPE "public"."plan_kind";--> statement-breakpoint
CREATE TYPE "public"."plan_kind" AS ENUM('per_minute', 'rental');--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "kind" SET DATA TYPE "public"."plan_kind" USING "kind"::"public"."plan_kind";--> statement-breakpoint

--> admin_role: 'operator' and 'viewer' become 'staff', whose access is the
--> permissions column backfilled above
ALTER TABLE "admins" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "admins" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
UPDATE "admins" SET "role" = 'staff' WHERE "role" IN ('operator', 'viewer');--> statement-breakpoint
DROP TYPE "public"."admin_role";--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('owner', 'staff');--> statement-breakpoint
ALTER TABLE "admins" ALTER COLUMN "role" SET DATA TYPE "public"."admin_role" USING "role"::"public"."admin_role";--> statement-breakpoint
ALTER TABLE "admins" ALTER COLUMN "role" SET DEFAULT 'staff'::"public"."admin_role";
