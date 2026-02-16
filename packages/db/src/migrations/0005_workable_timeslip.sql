CREATE TABLE "cloud_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"sandbox_provider_id" uuid,
	"model_provider_id" uuid NOT NULL,
	"remote_repo_owner" text NOT NULL,
	"remote_repo_name" text NOT NULL,
	"remote_branch" text NOT NULL,
	"sandbox_id" text,
	"opencode_session_id" text,
	"server_url" text,
	"base_commit_sha" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_session" ADD CONSTRAINT "cloud_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_session" ADD CONSTRAINT "cloud_session_sandbox_provider_id_cloud_provider_id_fk" FOREIGN KEY ("sandbox_provider_id") REFERENCES "public"."cloud_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_session" ADD CONSTRAINT "cloud_session_model_provider_id_model_provider_id_fk" FOREIGN KEY ("model_provider_id") REFERENCES "public"."model_provider"("id") ON DELETE cascade ON UPDATE no action;