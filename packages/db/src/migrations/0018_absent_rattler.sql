-- Map legacy resumable status before rewriting the enum.
ALTER TABLE "workspace" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "workspace" SET "status" = 'paused' WHERE "status" = 'stopped';--> statement-breakpoint
DROP TYPE "public"."workspace_status";--> statement-breakpoint
CREATE TYPE "public"."workspace_status" AS ENUM('pending', 'running', 'paused', 'terminated');--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "status" SET DATA TYPE "public"."workspace_status" USING "status"::"public"."workspace_status";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "repository_base_commit" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "repository_checkout_ref" text;--> statement-breakpoint
-- instance_status is unused by tables but keep it aligned with workspace_status.
DROP TYPE IF EXISTS "public"."instance_status";--> statement-breakpoint
CREATE TYPE "public"."instance_status" AS ENUM('pending', 'running', 'paused', 'terminated');
