ALTER TABLE "cloud_provider" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "machine_profile" ADD COLUMN "vcpus" real;--> statement-breakpoint
ALTER TABLE "machine_profile" ADD COLUMN "memory_gb" real;--> statement-breakpoint
UPDATE "machine_profile" SET "vcpus" = 1, "memory_gb" = 2 WHERE "provider_options" = '{"cpu": 1024, "memory": 2048}'::jsonb;
