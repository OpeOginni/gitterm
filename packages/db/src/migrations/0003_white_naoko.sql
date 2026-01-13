CREATE TYPE "public"."agent_loop_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'halted');--> statement-breakpoint
CREATE TYPE "public"."agent_loop_run_trigger_type" AS ENUM('manual', 'automated');--> statement-breakpoint
CREATE TYPE "public"."agent_loop_status" AS ENUM('active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TABLE "agent_loop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"git_integration_id" uuid,
	"sandbox_provider_id" uuid NOT NULL,
	"repository_owner" text NOT NULL,
	"repository_name" text NOT NULL,
	"branch" text NOT NULL,
	"plan_file_path" text NOT NULL,
	"progress_file_path" text,
	"prompt" text,
	"model_provider_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"credential_id" uuid,
	"automation_enabled" boolean DEFAULT false NOT NULL,
	"status" "agent_loop_status" DEFAULT 'active' NOT NULL,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"successful_runs" integer DEFAULT 0 NOT NULL,
	"failed_runs" integer DEFAULT 0 NOT NULL,
	"max_runs" integer DEFAULT 20 NOT NULL,
	"last_run_id" uuid,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_loop_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loop_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"status" "agent_loop_run_status" DEFAULT 'pending' NOT NULL,
	"trigger_type" "agent_loop_run_trigger_type" NOT NULL,
	"model_provider_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"sandbox_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_seconds" integer,
	"commit_sha" text,
	"commit_message" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_loop_run_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"runs_used" integer DEFAULT 0 NOT NULL,
	"runs_added" integer DEFAULT 0 NOT NULL,
	"loop_id" uuid,
	"run_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_loop_run_quota" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"monthly_runs" integer DEFAULT 0 NOT NULL,
	"extra_runs" integer DEFAULT 0 NOT NULL,
	"next_monthly_reset_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_loop_run_quota_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"model_id" text NOT NULL,
	"is_free" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_recommended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "model_provider_id_name" UNIQUE("provider_id","name")
);
--> statement-breakpoint
CREATE TABLE "model_credential_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"key_hash" text,
	"context" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_provider" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"auth_type" text NOT NULL,
	"oauth_config" jsonb,
	"plugin" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_recommended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "model_provider_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_model_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"encrypted_credential" text NOT NULL,
	"key_hash" text NOT NULL,
	"oauth_expires_at" timestamp,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_model_credential_user_provider_label" UNIQUE("user_id","provider_id","label")
);
--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD COLUMN "is_sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_git_integration_id_git_integration_id_fk" FOREIGN KEY ("git_integration_id") REFERENCES "public"."git_integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_sandbox_provider_id_cloud_provider_id_fk" FOREIGN KEY ("sandbox_provider_id") REFERENCES "public"."cloud_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_model_provider_id_model_provider_id_fk" FOREIGN KEY ("model_provider_id") REFERENCES "public"."model_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_credential_id_user_model_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."user_model_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop_run" ADD CONSTRAINT "agent_loop_run_loop_id_agent_loop_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."agent_loop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop_run" ADD CONSTRAINT "agent_loop_run_model_provider_id_model_provider_id_fk" FOREIGN KEY ("model_provider_id") REFERENCES "public"."model_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop_run" ADD CONSTRAINT "agent_loop_run_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_loop_run_event" ADD CONSTRAINT "user_loop_run_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_loop_run_event" ADD CONSTRAINT "user_loop_run_event_loop_id_agent_loop_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."agent_loop"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_loop_run_event" ADD CONSTRAINT "user_loop_run_event_run_id_agent_loop_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_loop_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_loop_run_quota" ADD CONSTRAINT "user_loop_run_quota_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_provider_id_model_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_credential_audit" ADD CONSTRAINT "model_credential_audit_credential_id_user_model_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."user_model_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_model_credential" ADD CONSTRAINT "user_model_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_model_credential" ADD CONSTRAINT "user_model_credential_provider_id_model_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_provider"("id") ON DELETE no action ON UPDATE no action;