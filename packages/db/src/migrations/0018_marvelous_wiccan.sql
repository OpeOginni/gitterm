CREATE TYPE "public"."agent_config_kind" AS ENUM('opencode', 'claude-code', 'codex');--> statement-breakpoint
ALTER TABLE "workspace_config" DROP CONSTRAINT "workspace_config_agent_type_id_agent_type_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_config" ADD COLUMN "kind" "agent_config_kind" DEFAULT 'opencode' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_config" DROP COLUMN "agent_type_id";
