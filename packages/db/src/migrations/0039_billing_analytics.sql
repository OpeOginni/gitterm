CREATE TABLE "billing_account_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analytics_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"effective_at" timestamp NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"commercial_category" text NOT NULL,
	"plan_version_id" text,
	"previous_plan" text,
	"plan" text NOT NULL,
	"previous_pay_as_you_go" boolean,
	"pay_as_you_go" boolean NOT NULL,
	"previous_spend_cap_cents" integer,
	"spend_cap_cents" integer,
	"period_start" timestamp,
	"period_end" timestamp,
	"subscription_id" text,
	"provenance" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "billing_account_event_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "billing_account_period" (
	"analytics_id" uuid NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"period_source" text NOT NULL,
	"status" text NOT NULL,
	"plan_version_id" text,
	"plan_id" text NOT NULL,
	"commercial_category" text NOT NULL,
	"plan_changed_mid_period" boolean NOT NULL,
	"pay_as_you_go" boolean NOT NULL,
	"spend_cap_cents" integer,
	"price_cents" integer,
	"included_cents" integer,
	"compute_seconds" bigint NOT NULL,
	"always_on_seconds" bigint NOT NULL,
	"unpriced_seconds" bigint NOT NULL,
	"retail_usage_micros" bigint NOT NULL,
	"included_consumed_cents" integer,
	"included_unused_cents" integer,
	"overage_billable_cents" integer,
	"invoiced_net_cents" integer,
	"invoiced_overage_cents" integer,
	"collected_net_cents" integer,
	"refunded_net_cents" integer,
	"tax_cents" integer,
	"payment_fee_cents" integer,
	"cost_estimate_micros" bigint,
	"uncosted_seconds" bigint NOT NULL,
	"contribution_before_shared_cents" integer,
	"denied_attempts" integer NOT NULL,
	"financial_pauses" integer NOT NULL,
	"alerts_reached" integer NOT NULL,
	"alerts_delivered" integer NOT NULL,
	"outcome" text,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"rebuilt_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_account_period_analytics_id_period_start_pk" PRIMARY KEY("analytics_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "billing_analytics_subject" (
	"user_id" text PRIMARY KEY NOT NULL,
	"analytics_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_created_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_analytics_subject_analytics_id_unique" UNIQUE("analytics_id")
);
--> statement-breakpoint
CREATE TABLE "billing_job_state" (
	"name" text PRIMARY KEY NOT NULL,
	"watermark" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_payment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analytics_id" uuid,
	"provider" text NOT NULL,
	"provider_customer_id" text,
	"kind" text NOT NULL,
	"provider_object_id" text NOT NULL,
	"order_id" text NOT NULL,
	"subscription_id" text,
	"product_id" text,
	"status" text NOT NULL,
	"billing_reason" text,
	"currency" text NOT NULL,
	"subtotal_cents" integer,
	"discount_cents" integer,
	"net_cents" integer,
	"tax_cents" integer,
	"total_cents" integer,
	"overage_cents" integer,
	"refunded_cents" integer,
	"refunded_tax_cents" integer,
	"platform_fee_cents" integer,
	"platform_fee_currency" text,
	"paid" boolean,
	"is_dispute" boolean DEFAULT false NOT NULL,
	"object_created_at" timestamp NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "billing_payment_event_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "billing_plan_version" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"price_cents" integer NOT NULL,
	"included_compute_cents" integer,
	"overage_discount_percent" real NOT NULL,
	"daily_minutes" integer,
	"entitlements" jsonb NOT NULL,
	"terms_schema_version" integer NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_product_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analytics_id" uuid NOT NULL,
	"workspace_id" uuid,
	"event_type" text NOT NULL,
	"schema_version" integer NOT NULL,
	"reason_code" text,
	"outcome" text,
	"occurred_at" timestamp NOT NULL,
	"plan_version_id" text,
	"included_cents" integer,
	"used_cents" integer,
	"reserve_cents" integer,
	"overage_cents" integer,
	"spend_cap_cents" integer,
	"pay_as_you_go" boolean,
	"latency_ms" integer,
	"provider_key" text,
	"dedupe_key" text,
	"metadata" jsonb,
	CONSTRAINT "billing_product_event_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "billing_provider_cost" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" text NOT NULL,
	"account_ref" text,
	"scope" text NOT NULL,
	"category" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"quantity" real,
	"unit" text,
	"currency" text NOT NULL,
	"estimated_micros" bigint,
	"invoiced_micros" bigint,
	"credits_micros" bigint,
	"cash_micros" bigint,
	"status" text NOT NULL,
	"source_record_id" text NOT NULL,
	"note" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_provider_cost_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_profile_id" uuid NOT NULL,
	"micros_per_hour" integer,
	"currency" text NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_usage_interval" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"analytics_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bot_id" uuid,
	"workload" text NOT NULL,
	"provider_key" text NOT NULL,
	"cloud_provider_id" uuid,
	"region" text,
	"hosting_type" text NOT NULL,
	"machine_profile_id" uuid,
	"machine_key" text,
	"machine_vcpus" real,
	"machine_memory_gb" real,
	"machine_provenance" text NOT NULL,
	"always_on" boolean NOT NULL,
	"started_at" timestamp NOT NULL,
	"stopped_at" timestamp,
	"stop_source" text,
	"retail_micros_per_hour" integer,
	"status" text NOT NULL,
	"provenance" text NOT NULL,
	"first_recorded_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_account" ADD COLUMN "commercial_category" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_account" ADD COLUMN "subscription_id" text;--> statement-breakpoint
ALTER TABLE "billing_account_event" ADD CONSTRAINT "billing_account_event_plan_version_id_billing_plan_version_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."billing_plan_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_analytics_subject" ADD CONSTRAINT "billing_analytics_subject_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_account_event_subject_idx" ON "billing_account_event" USING btree ("analytics_id","effective_at");--> statement-breakpoint
CREATE INDEX "billing_payment_event_object_idx" ON "billing_payment_event" USING btree ("provider_object_id","occurred_at");--> statement-breakpoint
CREATE INDEX "billing_payment_event_subject_idx" ON "billing_payment_event" USING btree ("analytics_id","occurred_at");--> statement-breakpoint
CREATE INDEX "billing_product_event_subject_idx" ON "billing_product_event" USING btree ("analytics_id","occurred_at");--> statement-breakpoint
CREATE INDEX "billing_product_event_type_idx" ON "billing_product_event" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_cost_source_unique" ON "billing_provider_cost" USING btree ("provider_key","source_record_id");--> statement-breakpoint
CREATE INDEX "billing_provider_cost_rate_profile_idx" ON "billing_provider_cost_rate" USING btree ("machine_profile_id","effective_from");--> statement-breakpoint
CREATE INDEX "billing_usage_interval_subject_idx" ON "billing_usage_interval" USING btree ("analytics_id","started_at");--> statement-breakpoint
CREATE INDEX "billing_usage_interval_started_idx" ON "billing_usage_interval" USING btree ("started_at");--> statement-breakpoint
-- Existing accounts predate category tracking: legacy plans are known, other paid plans are unknown.
UPDATE "billing_account" SET "commercial_category" = CASE "plan" WHEN 'free' THEN 'free' WHEN 'starter' THEN 'legacy' ELSE 'unknown' END;
