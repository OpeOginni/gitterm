ALTER TABLE "volume" ALTER COLUMN "region_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "region_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "supports_regions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "support_server_only" boolean DEFAULT false NOT NULL;