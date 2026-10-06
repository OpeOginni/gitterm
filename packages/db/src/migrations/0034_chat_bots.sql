CREATE TABLE "bot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"repo" text NOT NULL,
	"model" text NOT NULL,
	"credential" text,
	"connections" text[] DEFAULT '{}' NOT NULL,
	"provider" text,
	"github_access" text DEFAULT 'connection' NOT NULL,
	"channels" text[] DEFAULT '{}' NOT NULL,
	"allowed_users" text[] DEFAULT '{}' NOT NULL,
	"allow_guests" boolean DEFAULT false NOT NULL,
	"instructions" text,
	"setup" text,
	"api_token_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_api_token_id_unique" UNIQUE("api_token_id")
);
--> statement-breakpoint
ALTER TABLE "bot" ADD CONSTRAINT "bot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot" ADD CONSTRAINT "bot_api_token_id_api_token_id_fk" FOREIGN KEY ("api_token_id") REFERENCES "public"."api_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_user_idx" ON "bot" USING btree ("user_id");