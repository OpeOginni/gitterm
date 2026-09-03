-- Backfill labels for existing unlabelled credentials before enforcing NOT NULL.
-- The oldest unlabelled credential per user+provider becomes "default", later
-- ones "default-2", "default-3", ... unless that label is already taken.
WITH ranked AS (
  SELECT
    id,
    user_id,
    provider_id,
    row_number() OVER (PARTITION BY user_id, provider_id ORDER BY created_at, id) AS rn
  FROM "user_model_credential"
  WHERE label IS NULL
),
proposed AS (
  SELECT id, user_id, provider_id,
    CASE WHEN rn = 1 THEN 'default' ELSE 'default-' || rn END AS label
  FROM ranked
)
UPDATE "user_model_credential" c
SET label = p.label
FROM proposed p
WHERE c.id = p.id
  AND NOT EXISTS (
    SELECT 1 FROM "user_model_credential" x
    WHERE x.user_id = p.user_id AND x.provider_id = p.provider_id AND x.label = p.label
  );--> statement-breakpoint
-- Any leftovers (label collisions) get a label derived from their id.
UPDATE "user_model_credential"
SET label = 'credential-' || left(id::text, 8)
WHERE label IS NULL;--> statement-breakpoint
ALTER TABLE "user_model_credential" ALTER COLUMN "label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "auto_terminate_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "custom_image" text;