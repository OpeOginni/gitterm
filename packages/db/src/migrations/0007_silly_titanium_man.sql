ALTER TYPE "public"."creation_settlement" RENAME TO "settelment_enum";--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "allow_user_region_selection" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "stop_settlement" "settelment_enum" DEFAULT 'webhook';--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "restart_settlement" "settelment_enum" DEFAULT 'webhook';--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "termination_settlement" "settelment_enum" DEFAULT 'webhook';