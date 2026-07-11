CREATE TYPE "public"."agent_config_kind" AS ENUM('opencode', 'claude-code', 'codex');--> statement-breakpoint
ALTER TABLE "workspace_config" DROP CONSTRAINT "workspace_config_agent_type_id_agent_type_id_fk";
--> statement-breakpoint
ALTER TABLE "model_provider" ADD COLUMN "logical_provider_key" text;--> statement-breakpoint
UPDATE "model_provider" SET "logical_provider_key" = CASE WHEN "name" = 'openai-oauth' THEN 'openai' ELSE "name" END;--> statement-breakpoint
ALTER TABLE "model_provider" ALTER COLUMN "logical_provider_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_model_credential" ADD COLUMN "logical_provider_key" text;--> statement-breakpoint
UPDATE "user_model_credential" AS credential SET "logical_provider_key" = provider."logical_provider_key" FROM "model_provider" AS provider WHERE credential."provider_id" = provider."id";--> statement-breakpoint
ALTER TABLE "user_model_credential" ALTER COLUMN "logical_provider_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_model_credential" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
WITH ranked AS (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "user_id", "logical_provider_key" ORDER BY "created_at" ASC, "id" ASC) AS position FROM "user_model_credential" WHERE "is_active" = true) UPDATE "user_model_credential" SET "is_default" = true FROM ranked WHERE "user_model_credential"."id" = ranked."id" AND ranked.position = 1;--> statement-breakpoint
ALTER TABLE "workspace_config" ADD COLUMN "kind" "agent_config_kind" DEFAULT 'opencode' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "model_credential_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_model_credential_default_logical_provider" ON "user_model_credential" USING btree ("user_id","logical_provider_key") WHERE "user_model_credential"."is_default" = true and "user_model_credential"."is_active" = true;--> statement-breakpoint
ALTER TABLE "workspace_config" DROP COLUMN "agent_type_id";
