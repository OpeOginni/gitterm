FROM docker.io/cloudflare/sandbox:0.6.10

RUN npm install -g opencode-ai

RUN mkdir -p /root/.opencode/tool
COPY agent-callback.ts /root/.opencode/tool/agent-callback.ts

# Expose OpenCode server port
EXPOSE 4096