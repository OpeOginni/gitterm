CREATE TABLE "provider_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"config_metadata" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_config_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_type_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"field_label" text NOT NULL,
	"field_type" text NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"is_encrypted" boolean DEFAULT false NOT NULL,
	"default_value" text,
	"options" jsonb,
	"validation_rules" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"category" text NOT NULL,
	"config_schema" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_built_in" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_type_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sync_manifest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sync_project_id" uuid NOT NULL,
	"snapshot" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"parent_snapshot" text,
	"files" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"blob_sessions_dir" text NOT NULL,
	"blob_chunks_dir" text NOT NULL,
	"current_snapshot" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "provider_config_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_config" ADD CONSTRAINT "provider_config_provider_type_id_provider_type_id_fk" FOREIGN KEY ("provider_type_id") REFERENCES "public"."provider_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_config_field" ADD CONSTRAINT "provider_config_field_provider_type_id_provider_type_id_fk" FOREIGN KEY ("provider_type_id") REFERENCES "public"."provider_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_manifest" ADD CONSTRAINT "sync_manifest_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_manifest" ADD CONSTRAINT "sync_manifest_sync_project_id_sync_project_id_fk" FOREIGN KEY ("sync_project_id") REFERENCES "public"."sync_project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_project" ADD CONSTRAINT "sync_project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_manifest_user_id_sync_project_id_unique" ON "sync_manifest" USING btree ("user_id","sync_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_project_user_id_project_id_unique" ON "sync_project" USING btree ("user_id","project_id");--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD CONSTRAINT "cloud_provider_provider_config_id_provider_config_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."provider_config"("id") ON DELETE set null ON UPDATE no action;