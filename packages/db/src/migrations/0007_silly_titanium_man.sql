ALTER TYPE "public"."creation_settlement" RENAME TO "settlement_enum";--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "allow_user_region_selection" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "stop_settlement" "settlement_enum" DEFAULT 'webhook';--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "restart_settlement" "settlement_enum" DEFAULT 'webhook';--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "termination_settlement" "settlement_enum" DEFAULT 'webhook';