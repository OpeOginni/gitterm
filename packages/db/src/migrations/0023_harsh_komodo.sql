CREATE TYPE "public"."agent_run_status" AS ENUM('pending', 'running', 'retrying', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workspace_setup_status" AS ENUM('waiting', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"parent_run_id" uuid,
	"native_session_id" text,
	"native_message_id" text NOT NULL,
	"status" "agent_run_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"error_message" text,
	"final_text" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_setup" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"status" "workspace_setup_status" DEFAULT 'waiting' NOT NULL,
	"command" text NOT NULL,
	"exit_code" integer,
	"started_at" timestamp,
	"finished_at" timestamp,
	"log" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_setup_execution_id_unique" UNIQUE("execution_id")
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_parent_run_id_agent_run_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_setup" ADD CONSTRAINT "workspace_setup_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_workspace_idempotency_key_unique" ON "agent_run" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_parent_run_unique" ON "agent_run" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "agent_run_workspace_native_session_idx" ON "agent_run" USING btree ("workspace_id","native_session_id");--> statement-breakpoint
CREATE INDEX "agent_run_workspace_status_idx" ON "agent_run" USING btree ("workspace_id","status");
