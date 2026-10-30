-- Plain command-execution sandboxes reuse the workspace lifecycle (billing, usage, reaper).
-- The agent type stays disabled so the dashboard and createWorkspace never offer it as an agent.
INSERT INTO "agent_type" ("key", "name", "description", "provisioner_key", "server_only", "is_enabled")
VALUES ('sandbox', 'Sandbox', 'Plain command sandbox for local agents. No coding agent runs inside.', 'none', true, false)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "image" ("name", "image_id", "agent_type_id", "provider_metadata", "is_enabled")
SELECT 'gitterm-sandbox-e2b-base', 'base', "id", '{"e2b":{"templateId":"base"}}'::jsonb, true
FROM "agent_type" WHERE "key" = 'sandbox'
ON CONFLICT ("name") DO NOTHING;
