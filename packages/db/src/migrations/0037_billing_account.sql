CREATE TABLE "billing_account" (
	"user_id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_account" ADD CONSTRAINT "billing_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "billing_account" ("user_id", "plan") SELECT "id", "plan"::text FROM "user" WHERE "plan" <> 'free';
