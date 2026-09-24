CREATE TABLE "google_issuer_config" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"key_id" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"previous_public_key" jsonb,
	"previous_key_expires_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allow_personal" boolean DEFAULT true NOT NULL,
	"allow_shared" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Preserve existing connections; new deployments require explicit admin enablement.
INSERT INTO "integration_settings" ("key", "enabled")
SELECT 'google', true WHERE EXISTS (SELECT 1 FROM "google_cloud_integration");
--> statement-breakpoint
INSERT INTO "integration_settings" ("key", "enabled")
SELECT 'github', true WHERE EXISTS (SELECT 1 FROM "git_integration" WHERE "provider" = 'github');
--> statement-breakpoint
CREATE TABLE "github_app_config" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"slug" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"encrypted_webhook_secret" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_pat_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"account_login" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"token_suffix" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "github_pat_id" uuid;--> statement-breakpoint
ALTER TABLE "github_pat_connection" ADD CONSTRAINT "github_pat_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_github_pat_id_github_pat_connection_id_fk" FOREIGN KEY ("github_pat_id") REFERENCES "public"."github_pat_connection"("id") ON DELETE set null ON UPDATE no action;
