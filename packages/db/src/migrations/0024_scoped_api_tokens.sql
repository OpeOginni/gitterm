ALTER TABLE "api_token" ADD COLUMN "scopes" text[];--> statement-breakpoint
UPDATE "api_token" SET "scopes" = ARRAY[
	'identity:read',
	'workspace:read',
	'workspace:access',
	'workspace:write',
	'run:read',
	'run:write'
]::text[];--> statement-breakpoint
ALTER TABLE "api_token" ALTER COLUMN "scopes" SET NOT NULL;
