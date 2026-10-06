CREATE TABLE "billing_machine_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_profile_id" uuid NOT NULL,
	"micros_per_hour" integer,
	"effective_from" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_account" ADD COLUMN "period_start" timestamp;--> statement-breakpoint
ALTER TABLE "billing_account" ADD COLUMN "period_end" timestamp;--> statement-breakpoint
ALTER TABLE "billing_account" ADD COLUMN "pay_as_you_go" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_account" ADD COLUMN "spend_cap_cents" integer;--> statement-breakpoint
ALTER TABLE "billing_account" ADD COLUMN "alerts_sent" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_account" ADD COLUMN "alerts_period_start" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "always_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_machine_rate" ADD CONSTRAINT "billing_machine_rate_machine_profile_id_machine_profile_id_fk" FOREIGN KEY ("machine_profile_id") REFERENCES "public"."machine_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_machine_rate_profile_idx" ON "billing_machine_rate" USING btree ("machine_profile_id","effective_from");--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "plan";--> statement-breakpoint
DROP TYPE "public"."user_plan";--> statement-breakpoint
DROP TABLE "daily_usage" CASCADE;
