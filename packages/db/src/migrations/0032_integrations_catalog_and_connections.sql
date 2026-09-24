CREATE TABLE "github_repository_config" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"app_id" text,
	"slug" text,
	"encrypted_private_key" text,
	"encrypted_webhook_secret" text,
	"account_login" text,
	"encrypted_pat" text,
	"pat_suffix" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "workspace" ADD COLUMN "shared_git_connection_id" text;--> statement-breakpoint
-- Existing connections remain enabled after upgrade; fresh deployments require admin enablement.
INSERT INTO "integration_settings" ("key", "enabled", "allow_personal", "allow_shared")
SELECT 'google', true, true, false WHERE EXISTS (SELECT 1 FROM "google_cloud_integration");
--> statement-breakpoint
INSERT INTO "integration_settings" ("key", "enabled", "allow_personal", "allow_shared")
SELECT 'github', true, true, false WHERE EXISTS (SELECT 1 FROM "git_integration" WHERE "provider" = 'github');
