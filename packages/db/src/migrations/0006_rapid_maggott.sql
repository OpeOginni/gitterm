CREATE TYPE "public"."creation_settlement" AS ENUM('immediate', 'webhook', 'poll');--> statement-breakpoint
CREATE TABLE "workspace_route_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"port" integer,
	"encrypted_headers" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "volume" ALTER COLUMN "region_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "region_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "supports_regions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "support_server_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "creation_settlement" "creation_settlement" DEFAULT 'webhook';--> statement-breakpoint
ALTER TABLE "workspace_route_access" ADD CONSTRAINT "workspace_route_access_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;