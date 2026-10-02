CREATE TABLE "mcp_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"integration" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"auth_type" text NOT NULL,
	"encrypted_auth" text NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"codemode" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"tool_count" integer,
	"server_info" jsonb,
	"last_checked_at" timestamp,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_mcp_connection" (
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	CONSTRAINT "workspace_mcp_connection_workspace_id_connection_id_pk" PRIMARY KEY("workspace_id","connection_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_mcp_connection" ADD CONSTRAINT "workspace_mcp_connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_mcp_connection" ADD CONSTRAINT "workspace_mcp_connection_connection_id_mcp_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mcp_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_connection_user_idx" ON "mcp_connection" USING btree ("user_id");