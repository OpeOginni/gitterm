-- Cloudflare is no longer a provider. Its workspaces, images' provider rows, machine
-- profiles and admin config go with it (all reference these rows with ON DELETE CASCADE).
DELETE FROM "cloud_provider" WHERE "provider_key" = 'cloudflare';--> statement-breakpoint
DELETE FROM "provider_type" WHERE "name" = 'cloudflare';
