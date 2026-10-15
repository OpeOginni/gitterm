# exe.dev Provider

Runs GitTerm workspaces on persistent exe.dev Linux VMs.

## Config

Configure an `Automation API Token` in the GitTerm admin panel. The token must permit `new`, `rm`, `pause`, `resume`, `ssh`, `share port`, `share set-private`, `ssh-key add`, and `ssh-key generate-api-key` commands.

Generate it from exe.dev with an explicit expiry and only the required command permissions.

## Images

Each agent image enabled for exe.dev needs `providerMetadata.exedev`:

```json
{
  "exedev": {
    "image": "exeuntu",
    "cpu": 2,
    "memory": "8GB",
    "disk": "25GB"
  }
}
```

Images without a baked-in agent can supply `setupCommands`, which block startup
until installation succeeds. The seeded T3Code entry installs T3, Claude Code,
Codex, and OpenCode 1.x; its base VM must provide Node >=22.16 and npm. Pairing
credentials are captured using the same agent contract as the other SDK providers.

## Access

GitTerm creates a VM-scoped bearer token for each workspace and injects it into the exe.dev HTTPS proxy from Caddy. Users see only GitTerm URLs.

Workspace pause snapshots VM RAM to disk and frees CPU/memory. Resume restores that VM state. User SSH keys are scoped to the workspace VM tag.

## Reference

- [exe.dev sandbox documentation](https://exe.dev/sandbox)
- [exe.dev HTTPS API](https://exe.dev/docs/https-api)
