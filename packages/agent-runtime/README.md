# @gitterm/agent-runtime

Agent runtime and sandbox transports for GitTerm. Requires Node.js 22.12 or newer, or Bun.

```sh
npm install @gitterm/agent-runtime
```

```ts
import { createSandboxTransport } from "@gitterm/agent-runtime/sandbox/index";

const sandbox = createSandboxTransport({
  provider: "boat",
  apiKey: process.env.BOAT_API_KEY!,
});
```

The package includes its provider SDK dependencies. Consumers should install a fixed runtime
version and commit their lockfile. No copy of the GitTerm repository is needed.

To build and publish from the GitTerm repository:

```sh
bun run publish:agent-runtime
```
