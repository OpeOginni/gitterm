-- The runtime bundle was only used by Railway workspaces, which are gone.
DROP TABLE IF EXISTS "workspace_runtime_bundle" CASCADE;--> statement-breakpoint
-- Cloudflare is no longer a provider. Its workspaces, images' provider rows, machine
-- profiles and admin config go with it (all reference these rows with ON DELETE CASCADE).
DELETE FROM "cloud_provider" WHERE "provider_key" = 'cloudflare';--> statement-breakpoint
DELETE FROM "provider_type" WHERE "name" = 'cloudflare';--> statement-breakpoint
-- Workspaces made before the rewrite keep a bare provider id that nothing can pause, resume or
-- delete now (Railway has no workspace provider at all). There are no cloud users to keep.
DELETE FROM "workspace"
WHERE "external_instance_id" <> ''
  AND "external_instance_id" NOT LIKE 'sandbox:%'
  AND "cloud_provider_id" IN (
    SELECT "id" FROM "cloud_provider"
    WHERE "provider_key" IN ('e2b', 'daytona', 'vercel', 'boat', 'exedev', 'railway')
  );
