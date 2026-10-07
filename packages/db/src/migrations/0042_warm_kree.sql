CREATE TABLE "workspace_termination" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"generation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp
);
--> statement-breakpoint
ALTER TABLE "workspace_termination" ADD CONSTRAINT "workspace_termination_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;