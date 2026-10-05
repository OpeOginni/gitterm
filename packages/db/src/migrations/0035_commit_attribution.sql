ALTER TABLE "user" ADD COLUMN "show_gitterm_on_commits" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "deadline_at" timestamp;--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "bot_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "bot_id" uuid;