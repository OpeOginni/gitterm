FROM docker.io/cloudflare/sandbox:0.12.1

# The agent loop drives OpenCode through @cloudflare/sandbox/opencode, which speaks the 1.x API.
RUN npm install -g opencode-ai@1

RUN mkdir -p /root/.opencode/tool
COPY agent-callback.ts /root/.opencode/tool/agent-callback.ts

# Expose OpenCode server port
EXPOSE 4096