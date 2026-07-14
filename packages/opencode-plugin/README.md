# @gitterm/opencode-plugin

Run [OpenCode](https://opencode.ai) experimental remote workspaces on
[Gitterm](https://gitterm.dev).

## Install

Add the plugin to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@gitterm/opencode-plugin"]
}
```

OpenCode installs npm plugins automatically. Restart OpenCode after changing
its configuration.

Authenticate with `gitterm login`, or set `GITTERM_API_TOKEN`. The plugin uses
the hosted Gitterm API by default and also accepts plugin options for
self-hosted deployments:

```json
{
  "plugin": [
    [
      "@gitterm/opencode-plugin",
      {
        "serverUrl": "https://gitterm.example.com",
      }
    ]
  ]
}
```

Supported options are `serverUrl`, `token`, `regionId`, `persistent`,
`workspaceProfile`, `name`, `repo`, and `branch`.

This plugin requires an OpenCode release with the experimental workspace API.

## Publish

```sh
bun run build
npm publish --access public
```

The npm scope must grant the publishing account permission to publish
`@gitterm/opencode-plugin`.
