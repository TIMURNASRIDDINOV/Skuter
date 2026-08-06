ALTER TYPE "public"."zone_kind" ADD VALUE 'slow';--> statement-breakpoint
ALTER TABLE "zones" ADD COLUMN "speed_limit_kph" smallint;