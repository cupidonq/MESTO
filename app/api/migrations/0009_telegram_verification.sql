CREATE TABLE "telegram_link_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_requests_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
ALTER TABLE "email_verifications" ADD COLUMN "channel" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_user_id" bigint;--> statement-breakpoint
ALTER TABLE "telegram_link_requests" ADD CONSTRAINT "telegram_link_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_link_user_idx" ON "telegram_link_requests" USING btree ("user_id","created_at");