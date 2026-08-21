CREATE TYPE "public"."telegram_nonce_purpose" AS ENUM('login', 'link');--> statement-breakpoint
ALTER TABLE "telegram_login_nonces" ADD COLUMN "purpose" "telegram_nonce_purpose" DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_login_nonces" ADD COLUMN "chat_id" bigint;--> statement-breakpoint
ALTER TABLE "telegram_login_nonces" ADD COLUMN "phone" text;--> statement-breakpoint
CREATE INDEX "telegram_login_nonces_chat_idx" ON "telegram_login_nonces" USING btree ("chat_id","created_at");