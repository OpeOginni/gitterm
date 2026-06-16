# Container image for GitTerm Cloudflare compute sandboxes.
#
# IMPORTANT: the tag here MUST match the @cloudflare/sandbox npm version used by
# the worker (see packages/api/package.json). A mismatch will cause the Sandbox
# SDK to throw a version-compatibility error at runtime.
FROM docker.io/cloudflare/sandbox:0.12.1

# OpenCode is the agent runtime users interact with inside the workspace.
RUN npm install -g opencode-ai

# OpenCode server listens here; the worker proxies workspace traffic to it.
EXPOSE 4096
