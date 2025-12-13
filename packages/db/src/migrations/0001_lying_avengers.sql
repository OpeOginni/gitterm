CREATE TYPE "public"."workspace_tunnel_type" AS ENUM('cloud', 'local');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "allow_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_type" ADD COLUMN "server_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "git_integration_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "persistent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "server_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "tunnel_type" "workspace_tunnel_type" DEFAULT 'cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "tunnel_name" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "reserved_subdomain" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "local_port" integer;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "exposed_ports" jsonb;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "tunnel_connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "tunnel_last_ping_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_git_integration_id_git_integration_id_fk" FOREIGN KEY ("git_integration_id") REFERENCES "public"."git_integration"("id") ON DELETE set null ON UPDATE no action;