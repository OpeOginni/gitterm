-- Rename in place so provider configs, workspaces, billing and defaults retain their IDs.
UPDATE "provider_type" SET "name" = 'boat', "display_name" = 'Boat', "updated_at" = now()
WHERE "name" = 'ascii';
--> statement-breakpoint
UPDATE "cloud_provider" SET "provider_key" = 'boat',
  "name" = CASE WHEN "name" IN ('boat', 'Ascii Box') THEN 'Boat' ELSE "name" END,
  "updated_at" = now()
WHERE "provider_key" = 'ascii';
--> statement-breakpoint
-- Prefer explicitly configured Boat metadata if both keys already exist.
UPDATE "image" SET "provider_metadata" = ("provider_metadata" - 'ascii') ||
  jsonb_build_object('boat', COALESCE("provider_metadata"->'boat', "provider_metadata"->'ascii'))
WHERE "provider_metadata" ? 'ascii';
--> statement-breakpoint
UPDATE "provider_config_field" SET "field_label" = 'Boat API key', "updated_at" = now()
WHERE "provider_type_id" IN (SELECT "id" FROM "provider_type" WHERE "name" = 'boat')
  AND "field_name" = 'apiKey';
--> statement-breakpoint
UPDATE "billing_usage_interval" SET "provider_key" = 'boat' WHERE "provider_key" = 'ascii';
--> statement-breakpoint
UPDATE "billing_provider_cost" SET "provider_key" = 'boat' WHERE "provider_key" = 'ascii';
--> statement-breakpoint
UPDATE "billing_product_event" SET "provider_key" = 'boat' WHERE "provider_key" = 'ascii';
