ALTER TABLE "sandbox_snapshot" ADD COLUMN "repository_url" text;--> statement-breakpoint
ALTER TABLE "sandbox_snapshot" ADD COLUMN "image_id" uuid;--> statement-breakpoint
ALTER TABLE "sandbox_snapshot" ADD CONSTRAINT "sandbox_snapshot_image_id_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_snapshot_project_idx" ON "sandbox_snapshot" USING btree ("user_id","repository_url");