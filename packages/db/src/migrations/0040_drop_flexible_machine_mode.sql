-- "Users pick or customize" was removed; those providers keep letting users pick a size.
UPDATE "cloud_provider" SET "machine_selection_policy" = '{"mode":"profiles"}'::jsonb WHERE "machine_selection_policy"->>'mode' = 'flexible';
