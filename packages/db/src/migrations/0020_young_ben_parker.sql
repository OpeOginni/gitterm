CREATE TABLE "machine_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cloud_provider_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"provider_options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "provider_agent_image_unique";--> statement-breakpoint
ALTER TABLE "provider_agent_image" ALTER COLUMN "workspace_profile" SET DEFAULT 'standard';--> statement-breakpoint
UPDATE "provider_agent_image" SET "workspace_profile" = 'standard' WHERE "workspace_profile" IS NULL;--> statement-breakpoint
ALTER TABLE "provider_agent_image" ALTER COLUMN "workspace_profile" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_type" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "agent_type" ADD COLUMN "provisioner_key" text DEFAULT 'opencode' NOT NULL;--> statement-breakpoint
UPDATE "agent_type"
SET "key" = CASE
	WHEN lower("name") = 'opencode' THEN 'opencode'
	WHEN lower("name") = 'opencode (ttyd)' THEN 'opencode-ttyd'
	WHEN lower("name") = 't3code' THEN 't3code'
	ELSE trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')) || '-' || left("id"::text, 8)
END,
"provisioner_key" = CASE WHEN lower("name") LIKE 't3code%' THEN 't3code' ELSE 'opencode' END;--> statement-breakpoint
ALTER TABLE "agent_type" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "machine_selection_policy" jsonb DEFAULT '{"mode":"standard"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_agent_image" ADD COLUMN "machine_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_agent_image" ADD COLUMN "runtime_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_agent_image" ADD COLUMN "is_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "machine_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "launch_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "machine_profile" ADD CONSTRAINT "machine_profile_cloud_provider_id_cloud_provider_id_fk" FOREIGN KEY ("cloud_provider_id") REFERENCES "public"."cloud_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "machine_profile_provider_key_unique" ON "machine_profile" USING btree ("cloud_provider_id","key");--> statement-breakpoint
ALTER TABLE "provider_agent_image" ADD CONSTRAINT "provider_agent_image_machine_profile_id_machine_profile_id_fk" FOREIGN KEY ("machine_profile_id") REFERENCES "public"."machine_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_machine_profile_id_machine_profile_id_fk" FOREIGN KEY ("machine_profile_id") REFERENCES "public"."machine_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_launch_profile_id_provider_agent_image_id_fk" FOREIGN KEY ("launch_profile_id") REFERENCES "public"."provider_agent_image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_agent_image_unique" ON "provider_agent_image" USING btree ("cloud_provider_id","agent_type_id","workspace_profile");--> statement-breakpoint
ALTER TABLE "provider_agent_image" DROP COLUMN "is_default";--> statement-breakpoint
ALTER TABLE "agent_type" ADD CONSTRAINT "agent_type_key_unique" UNIQUE("key");
