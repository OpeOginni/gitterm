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
