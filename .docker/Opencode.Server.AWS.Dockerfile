# OpenCode server image with the AWS, AWS SAM, and GitHub CLIs preinstalled for
# workspaces that use AWS access profiles. Register it in Admin -> Images with
# AWS-only provider metadata so it is selected instead of the general image.
# Installing these tools at workspace start would consume the startup budget.
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

# Install the official GitHub CLI release directly.
RUN case "$(uname -m)" in aarch64|arm64) gh_arch=arm64 ;; *) gh_arch=amd64 ;; esac \
    && GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep '"tag_name"' | sed -E 's/.*"v([^" ]+)".*/\1/')" \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${gh_arch}.tar.gz" -o /tmp/gh.tar.gz \
    && tar -xzf /tmp/gh.tar.gz -C /tmp \
    && install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${gh_arch}/bin/gh" /usr/local/bin/gh \
    && rm -rf /tmp/gh.tar.gz "/tmp/gh_${GH_VERSION}_linux_${gh_arch}" \
    && gh --version

# Install the AWS SAM CLI. Keep the version configurable so image rebuilds can
# be pinned when an upstream release needs to be held back.
ARG AWS_SAM_CLI_VERSION=latest
RUN case "$(uname -m)" in aarch64|arm64) sam_arch=arm64 ;; *) sam_arch=x86_64 ;; esac \
    && curl -fsSL "https://github.com/aws/aws-sam-cli/releases/${AWS_SAM_CLI_VERSION}/download/aws-sam-cli-linux-${sam_arch}.zip" -o /tmp/aws-sam-cli.zip \
    && unzip -q /tmp/aws-sam-cli.zip -d /tmp/aws-sam-cli \
    && /tmp/aws-sam-cli/install --update -i /usr/local/aws-sam-cli -b /usr/local/bin \
    && rm -rf /tmp/aws-sam-cli /tmp/aws-sam-cli.zip \
    && sam --version

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
