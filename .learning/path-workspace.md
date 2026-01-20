# Issues with path Based Workspace

In cases like running the desktop app and also frontends through ports in a workspace.

The workspace is located at gitterm.dev/ws/12345

When a frontend uses absolute paths it always goes to the host `gitterm.dev/bundle.js`, when the resources it needs are in the path `gitterm.dev/ws/12345/bundle.js`. 

## Potential Solutions

1. Inject a `<base>` tag into the HTML (seems impossible with caddy)
2.