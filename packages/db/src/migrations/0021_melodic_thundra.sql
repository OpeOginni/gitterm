CREATE TABLE "workspace_setup_command_default" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cloud_provider_id" uuid NOT NULL,
	"agent_type_id" uuid,
	"commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_setup_command_default" ADD CONSTRAINT "workspace_setup_command_default_cloud_provider_id_cloud_provider_id_fk" FOREIGN KEY ("cloud_provider_id") REFERENCES "public"."cloud_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_setup_command_default" ADD CONSTRAINT "workspace_setup_command_default_agent_type_id_agent_type_id_fk" FOREIGN KEY ("agent_type_id") REFERENCES "public"."agent_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_setup_default_provider_unique" ON "workspace_setup_command_default" USING btree ("cloud_provider_id") WHERE "workspace_setup_command_default"."agent_type_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_setup_default_provider_agent_unique" ON "workspace_setup_command_default" USING btree ("cloud_provider_id","agent_type_id") WHERE "workspace_setup_command_default"."agent_type_id" is not null;
--> statement-breakpoint
UPDATE "image"
SET "provider_metadata" = jsonb_set(
  COALESCE("provider_metadata", '{}'::jsonb),
  '{aws}',
  '{"cpu":4096,"memory":16384,"containerPort":7681,"healthCheckPath":"/"}'::jsonb,
  true
), "updated_at" = now()
WHERE "name" = 'gitterm-opencode-server';
--> statement-breakpoint
UPDATE "workspace"
SET "image_id" = (SELECT "id" FROM "image" WHERE "name" = 'gitterm-opencode-server' LIMIT 1)
WHERE "image_id" = (SELECT "id" FROM "image" WHERE "name" = 'gitterm-opencode-aws-server' LIMIT 1)
  AND EXISTS (SELECT 1 FROM "image" WHERE "name" = 'gitterm-opencode-server');
--> statement-breakpoint
UPDATE "provider_agent_image"
SET "image_id" = (SELECT "id" FROM "image" WHERE "name" = 'gitterm-opencode-server' LIMIT 1)
WHERE "image_id" = (SELECT "id" FROM "image" WHERE "name" = 'gitterm-opencode-aws-server' LIMIT 1)
  AND EXISTS (SELECT 1 FROM "image" WHERE "name" = 'gitterm-opencode-server');
--> statement-breakpoint
DELETE FROM "image"
WHERE "name" = 'gitterm-opencode-aws-server'
  AND EXISTS (SELECT 1 FROM "image" WHERE "name" = 'gitterm-opencode-server');
--> statement-breakpoint
INSERT INTO "workspace_setup_command_default" (
  "cloud_provider_id", "agent_type_id", "commands", "created_at", "updated_at"
)
SELECT
  "id",
  NULL,
  jsonb_build_array($setup$if ! command -v aws >/dev/null 2>&1; then
  tmp_dir=$(mktemp -d)
  case "$(uname -m)" in
    aarch64|arm64) aws_arch=aarch64 ;;
    *) aws_arch=x86_64 ;;
  esac
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$aws_arch.zip" -o "$tmp_dir/awscliv2.zip"
  unzip -q "$tmp_dir/awscliv2.zip" -d "$tmp_dir"
  "$tmp_dir/aws/install" --update
  rm -rf "$tmp_dir"
fi$setup$),
  now(),
  now()
FROM "cloud_provider"
WHERE "provider_key" = 'aws';
