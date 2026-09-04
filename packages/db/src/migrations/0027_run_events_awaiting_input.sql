CREATE TYPE "public"."opencode_api" AS ENUM('v1', 'v2');--> statement-breakpoint
ALTER TYPE "public"."agent_run_status" ADD VALUE 'awaiting_input' BEFORE 'completed';--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "pending_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "opencode_api" "opencode_api" DEFAULT 'v1' NOT NULL;