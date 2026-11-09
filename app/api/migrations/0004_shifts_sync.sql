CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_shift_id" uuid,
	"device_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_cash" bigint DEFAULT 0 NOT NULL,
	"closing_cash_declared" bigint,
	"closing_cash_expected" bigint
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_project_client_uq" ON "shifts" USING btree ("project_id","client_shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_uq" ON "shifts" USING btree ("project_id","user_id") WHERE "shifts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "shifts_project_opened_idx" ON "shifts" USING btree ("project_id","opened_at");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;