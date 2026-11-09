ALTER TABLE "billing_checkouts" ADD COLUMN "days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "days" integer;