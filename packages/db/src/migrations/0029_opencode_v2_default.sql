ALTER TABLE "workspace" ALTER COLUMN "opencode_api" SET DEFAULT 'v2';--> statement-breakpoint
UPDATE "workspace" SET "opencode_api" = 'v2' WHERE "opencode_api" = 'v1';
