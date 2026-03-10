ALTER TABLE "workspace" ADD COLUMN "server_password" text;--> statement-breakpoint
ALTER TABLE "workspace" DROP COLUMN "local_port";--> statement-breakpoint
ALTER TABLE "workspace" DROP COLUMN "tunnel_connected_at";--> statement-breakpoint
ALTER TABLE "workspace" DROP COLUMN "tunnel_last_ping_at";