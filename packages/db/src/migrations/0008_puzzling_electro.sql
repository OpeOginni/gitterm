CREATE TYPE "public"."workspace_editor_target" AS ENUM('vscode', 'neovim');--> statement-breakpoint
CREATE TYPE "public"."workspace_profile" AS ENUM('standard', 'ssh-enabled');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ssh_public_key" text;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "editor_access_support" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "image" ADD COLUMN "provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "repository_branch" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "workspace_profile" "workspace_profile" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "editor_access_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "editor_target" "workspace_editor_target";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "editor_connection" jsonb;