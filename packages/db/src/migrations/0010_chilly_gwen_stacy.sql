ALTER TABLE "agent_type" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "auto_persistent" boolean DEFAULT false NOT NULL;