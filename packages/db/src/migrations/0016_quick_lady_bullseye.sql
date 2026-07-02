CREATE TYPE "public"."workspace_access_role" AS ENUM('viewer', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."workspace_share_invite_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workspace_share_team_member_role" AS ENUM('member', 'manager');--> statement-breakpoint
CREATE TABLE "workspace_share_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"inviter_id" text NOT NULL,
	"invited_user_id" text,
	"email" text NOT NULL,
	"role" "workspace_access_role" DEFAULT 'viewer' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "workspace_share_invite_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"declined_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_share_invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_share_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_share_team_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"inviter_id" text NOT NULL,
	"invited_user_id" text,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "workspace_share_invite_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"declined_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_share_team_invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_share_team_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_share_team_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_team_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"role" "workspace_access_role" DEFAULT 'viewer' NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_user_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_access_role" DEFAULT 'viewer' NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_share_invite" ADD CONSTRAINT "workspace_share_invite_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_share_invite" ADD CONSTRAINT "workspace_share_invite_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_share_invite" ADD CONSTRAINT "workspace_share_invite_invited_user_id_user_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_share_team" ADD CONSTRAINT "workspace_share_team_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_share_team_invite" ADD CONSTRAINT "workspace_share_team_invite_team_id_workspace_share_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."workspace_share_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_share_team_invite" ADD CONSTRAINT "workspace_share_team_invite_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_share_team_invite" ADD CONSTRAINT "workspace_share_team_invite_invited_user_id_user_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_share_team_member" ADD CONSTRAINT "workspace_share_team_member_team_id_workspace_share_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."workspace_share_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_share_team_member" ADD CONSTRAINT "workspace_share_team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_team_access" ADD CONSTRAINT "workspace_team_access_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_team_access" ADD CONSTRAINT "workspace_team_access_team_id_workspace_share_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."workspace_share_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_team_access" ADD CONSTRAINT "workspace_team_access_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_user_access" ADD CONSTRAINT "workspace_user_access_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_user_access" ADD CONSTRAINT "workspace_user_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_user_access" ADD CONSTRAINT "workspace_user_access_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_share_invite_workspace_email_unique" ON "workspace_share_invite" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_share_team_creator_name_unique" ON "workspace_share_team" USING btree ("creator_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_share_team_invite_team_email_unique" ON "workspace_share_team_invite" USING btree ("team_id","email");--> statement-breakpoint
CREATE INDEX "workspace_share_team_member_user_idx" ON "workspace_share_team_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_share_team_member_team_user_unique" ON "workspace_share_team_member" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_team_access_team_idx" ON "workspace_team_access" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_team_access_workspace_team_unique" ON "workspace_team_access" USING btree ("workspace_id","team_id");--> statement-breakpoint
CREATE INDEX "workspace_user_access_user_idx" ON "workspace_user_access" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_user_access_workspace_user_unique" ON "workspace_user_access" USING btree ("workspace_id","user_id");