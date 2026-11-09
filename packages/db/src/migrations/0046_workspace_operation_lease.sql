ALTER TABLE "workspace" ADD COLUMN "operation_lease_until" timestamp;
--> statement-breakpoint
CREATE TABLE "sandbox_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"cloud_provider_id" uuid NOT NULL,
	"machine_profile_id" uuid,
	"external_snapshot_id" text,
	"label" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_snapshot" ADD CONSTRAINT "sandbox_snapshot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_snapshot" ADD CONSTRAINT "sandbox_snapshot_cloud_provider_id_cloud_provider_id_fk" FOREIGN KEY ("cloud_provider_id") REFERENCES "public"."cloud_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_snapshot" ADD CONSTRAINT "sandbox_snapshot_machine_profile_id_machine_profile_id_fk" FOREIGN KEY ("machine_profile_id") REFERENCES "public"."machine_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_snapshot_user_idx" ON "sandbox_snapshot" USING btree ("user_id");
