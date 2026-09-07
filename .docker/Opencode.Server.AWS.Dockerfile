# OpenCode server image with the AWS CLI preinstalled, for workspaces that use AWS
# access profiles. Not seeded: build and push it, then register it in Admin -> Images
# (or pass it as a bring-your-own image) and assign it to the AWS provider.
# Installing the CLI at workspace start instead costs ~100s of the startup budget.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    unzip \
    ca-certificates \
    nodejs \
    npm \
    openssh-server \
    && rm -rf /var/lib/apt/lists/*

RUN case "$(uname -m)" in aarch64|arm64) aws_arch=aarch64 ;; *) aws_arch=x86_64 ;; esac \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" -o /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install --install-dir /usr/local/aws-cli --bin-dir /usr/local/bin \
    && rm -rf /tmp/aws /tmp/awscliv2.zip \
    && aws --version

# Install OpenCode AI globally (IMPORTANT: keep global installs OUTSIDE /workspace)
# /workspace is a persisted volume in GitTerm, so anything installed under it can disappear on mount.
ARG OPENCODE_VERSION=latest
ARG OPENCODE_INSTALL_CACHE_BUST=manual
RUN echo "opencode install cache bust: ${OPENCODE_INSTALL_CACHE_BUST}" \
    && npm cache clean --force \
    && echo "npm latest opencode-ai: $(npm view opencode-ai@${OPENCODE_VERSION} version)" \
    && npm install -g "opencode-ai@${OPENCODE_VERSION}" "@gitterm/cli@latest" --prefer-online --no-audit --fund=false \
    && echo "installed opencode: $(opencode --version)"

WORKDIR /workspace

ENV HOME=/workspace \
    XDG_CONFIG_HOME=/workspace/.config \
    XDG_DATA_HOME=/workspace/.local/share \
    XDG_STATE_HOME=/workspace/.local/state \
    XDG_CACHE_HOME=/workspace/.cache \
    NPM_CONFIG_USERCONFIG=/workspace/.npmrc \
    NPM_CONFIG_CACHE=/workspace/.npm \
    OPENCODE_CONFIG_DIR=/workspace/.config/opencode \
    OPENCODE_DATA_DIR=/workspace/.local/share/opencode \
    OPENCODE_CACHE_DIR=/workspace/.cache/opencode \
    HISTFILE=/workspace/.bash_history \
    PATH=/workspace/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

COPY ./opencode/server.entrypoint.sh /entrypoint.sh
COPY ./workspace-setup-runner.sh /usr/local/bin/gitterm-workspace-setup
COPY ./git-credential-github.mjs /usr/local/bin/gitterm-git-credential
RUN chmod +x /entrypoint.sh /usr/local/bin/gitterm-workspace-setup /usr/local/bin/gitterm-git-credential

ENV PORT=7681
EXPOSE 22
EXPOSE 7681

ENTRYPOINT ["/entrypoint.sh"]

# IPv6 support
CMD ["opencode", "serve", "--port", "7681", "--hostname", "[::]"]
