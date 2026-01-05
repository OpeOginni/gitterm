ALTER TYPE "public"."workspace_tunnel_type" RENAME TO "workspace_hosting_type";--> statement-breakpoint
ALTER TABLE "workspace" RENAME COLUMN "backend_url" TO "upstream_url";--> statement-breakpoint
ALTER TABLE "workspace" RENAME COLUMN "tunnel_type" TO "hosting_type";--> statement-breakpoint
ALTER TABLE "workspace" RENAME COLUMN "tunnel_name" TO "name";