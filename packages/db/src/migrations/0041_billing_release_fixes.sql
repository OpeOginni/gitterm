CREATE TABLE "billing_overage" (
	"user_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"earned_cents" integer DEFAULT 0 NOT NULL,
	"reported_cents" integer DEFAULT 0 NOT NULL,
	"included_cents" integer NOT NULL,
	"overage_discount_percent" integer NOT NULL,
	"spend_cap_cents" integer,
	"pay_as_you_go" boolean DEFAULT true NOT NULL,
	"closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_overage_user_id_period_start_pk" PRIMARY KEY("user_id","period_start")
);
--> statement-breakpoint
ALTER TABLE "billing_account" ADD COLUMN "subscription_modified_at" timestamp;--> statement-breakpoint
ALTER TABLE "billing_overage" ADD CONSTRAINT "billing_overage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_overage_unsettled_idx" ON "billing_overage" USING btree ("closed_at");