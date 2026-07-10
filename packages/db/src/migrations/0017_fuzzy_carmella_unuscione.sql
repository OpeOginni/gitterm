CREATE TABLE "api_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "api_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DROP TYPE "public"."instance_status";--> statement-breakpoint
CREATE TYPE "public"."instance_status" AS ENUM('pending', 'running', 'paused', 'terminated');--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."workspace_status";--> statement-breakpoint
CREATE TYPE "public"."workspace_status" AS ENUM('pending', 'running', 'paused', 'terminated');--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "status" SET DATA TYPE "public"."workspace_status" USING "status"::"public"."workspace_status";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "repository_base_commit" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "repository_checkout_ref" text;--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;