CREATE TABLE "workspace_credential_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"credential_kind" text NOT NULL,
	"integration_id" uuid,
	"action" text NOT NULL,
	"expires_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_runtime_bundle" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_payload" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_cloud_integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"project_id" text NOT NULL,
	"workload_identity_provider" text NOT NULL,
	"service_account_email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "google_cloud_integration_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "auth_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_credential_audit" ADD CONSTRAINT "workspace_credential_audit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_credential_audit" ADD CONSTRAINT "workspace_credential_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runtime_bundle" ADD CONSTRAINT "workspace_runtime_bundle_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_cloud_integration" ADD CONSTRAINT "google_cloud_integration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_credential_audit_workspace_created_idx" ON "workspace_credential_audit" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_google_cloud_integration_id_google_cloud_integration_id_fk" FOREIGN KEY ("google_cloud_integration_id") REFERENCES "public"."google_cloud_integration"("id") ON DELETE set null ON UPDATE no action;