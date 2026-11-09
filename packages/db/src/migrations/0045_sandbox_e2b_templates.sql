-- Managed E2B sandboxes start from gitterm-sandbox templates, one per machine size
-- (gitterm-sandbox, -sm, -lg), so the billed profile's size is the size provisioned.
-- Build them first: bun run e2b:build --agent sandbox. A template an admin changed is kept.
UPDATE "image"
SET "image_id" = 'gitterm-sandbox',
  "provider_metadata" = jsonb_set("provider_metadata", '{e2b,templateId}', '"gitterm-sandbox"'),
  "updated_at" = now()
WHERE "name" = 'gitterm-sandbox-e2b-base'
  AND "provider_metadata"->'e2b'->>'templateId' = 'base';
