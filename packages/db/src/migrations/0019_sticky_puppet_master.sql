ALTER TABLE "workspace" RENAME COLUMN "stopped_at" TO "paused_at";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_user_idempotency_key_unique" ON "workspace" USING btree ("user_id","idempotency_key");