CREATE TABLE "telegram_login_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce" text NOT NULL,
	"user_id" uuid,
	"telegram_id" bigint,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_id" bigint;--> statement-breakpoint
ALTER TABLE "telegram_login_nonces" ADD CONSTRAINT "telegram_login_nonces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_login_nonces_nonce_key" ON "telegram_login_nonces" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "telegram_login_nonces_expires_idx" ON "telegram_login_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users" USING btree ("telegram_id");