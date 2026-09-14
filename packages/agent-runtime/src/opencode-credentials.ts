const OPENCODE_DATA_DIRECTORY =
  "${OPENCODE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/opencode}";

/** Import GitTerm's short-lived credential seed into OpenCode V2's SQLite store. */
export const OPENCODE_V2_IMPORT_CREDENTIALS = `AUTH_FILE="${OPENCODE_DATA_DIRECTORY}/auth.json"
if [ -f "$AUTH_FILE" ]; then
  opencode auth list --standalone >/dev/null
  DATABASE_FILE="${OPENCODE_DATA_DIRECTORY}/opencode.db"
  sqlite3 "$DATABASE_FILE" \
    -cmd '.parameter init' \
    -cmd ".parameter set @auth_file '$AUTH_FILE'" <<'SQL'
.bail on
BEGIN IMMEDIATE;
CREATE TEMP TABLE gitterm_seed AS
SELECT rtrim(key, '/') AS integration_id, value AS credential
FROM json_each(readfile(@auth_file));

CREATE TEMP TABLE gitterm_validation (errors INTEGER CHECK (errors = 0));
INSERT INTO gitterm_validation
SELECT
  CASE WHEN json_type(readfile(@auth_file)) = 'object' THEN 0 ELSE 1 END
  + count(*) FILTER (WHERE
    integration_id = ''
    OR json_type(credential) <> 'object'
    OR NOT (
      (json_extract(credential, '$.type') = 'api'
        AND json_type(credential, '$.key') = 'text')
      OR
      (json_extract(credential, '$.type') = 'oauth'
        AND json_type(credential, '$.refresh') = 'text'
        AND json_type(credential, '$.access') = 'text'
        AND json_type(credential, '$.expires') = 'integer'
        AND json_extract(credential, '$.expires') >= 0)
    )
  )
FROM gitterm_seed;

INSERT INTO credential
  (id, integration_id, label, value, active, time_created, time_updated)
SELECT
  'cred_' || lower(hex(randomblob(16))),
  integration_id,
  CASE json_extract(credential, '$.type') WHEN 'api' THEN 'API key' ELSE 'OAuth' END,
  CASE json_extract(credential, '$.type')
    WHEN 'api' THEN
      CASE WHEN json_type(credential, '$.metadata') = 'object'
        THEN json_set(
          json_object('type', 'key', 'key', json_extract(credential, '$.key')),
          '$.metadata', json(json_extract(credential, '$.metadata'))
        )
        ELSE json_object('type', 'key', 'key', json_extract(credential, '$.key'))
      END
    ELSE json_set(
      json_object(
        'type', 'oauth',
        'methodID', CASE
          WHEN integration_id = 'openai' THEN 'chatgpt-browser'
          WHEN integration_id IN ('github-copilot', 'opencode', 'xai') THEN 'device'
          ELSE 'oauth'
        END,
        'refresh', json_extract(credential, '$.refresh'),
        'access', json_extract(credential, '$.access'),
        'expires', json_extract(credential, '$.expires')
      ),
      '$.metadata', json_patch(
        CASE WHEN json_type(credential, '$.accountId') = 'text'
          THEN json_object('accountID', json_extract(credential, '$.accountId')) ELSE '{}' END,
        CASE WHEN json_type(credential, '$.enterpriseUrl') = 'text'
          THEN json_object('enterpriseUrl', json_extract(credential, '$.enterpriseUrl')) ELSE '{}' END
      )
    )
  END,
  1,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM gitterm_seed
WHERE NOT EXISTS (
  SELECT 1 FROM credential AS existing
  WHERE existing.integration_id = gitterm_seed.integration_id
);

DELETE FROM gitterm_validation;
INSERT INTO gitterm_validation
SELECT count(*)
FROM gitterm_seed
WHERE NOT EXISTS (
  SELECT 1 FROM credential AS imported
  WHERE imported.integration_id = gitterm_seed.integration_id
);
COMMIT;
SQL
  rm -f "$AUTH_FILE"
fi`;
