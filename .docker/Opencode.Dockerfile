# Build the browser independently of ttyd's internal frontend.
FROM node:22-bookworm-slim AS browser
WORKDIR /browser
COPY ./custom/package.json ./custom/package-lock.json ./
RUN npm ci --no-audit --fund=false
COPY ./custom/build.mjs ./custom/tsconfig.json ./
COPY ./custom/src ./src
RUN npm run check-types && npm run build

# Build the pinned, unmodified ttyd backend.
FROM node:20-bookworm-slim AS builder

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    cmake \
    build-essential \
    libjson-c-dev \
    libwebsockets-dev \
    libssl-dev \
    zlib1g-dev \
    libuv1-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pin ttyd's transport independently of the browser frontend.
ARG TTYD_COMMIT=2922cb89f518bae4d0fcf4d757a7419638fc71fc
WORKDIR /build
RUN git init ttyd \
    && cd ttyd \
    && git remote add origin https://github.com/tsl0922/ttyd.git \
    && git fetch --depth 1 origin "${TTYD_COMMIT}" \
    && git checkout --detach FETCH_HEAD

# Now build the backend
WORKDIR /build/ttyd
RUN mkdir build && \
    cd build && \
    cmake .. && \
    make && \
    make install

# Small integration target: real ttyd/tmux without downloading agent runtimes.
FROM builder AS terminal-test
RUN apt-get update && apt-get install -y --no-install-recommends tmux && rm -rf /var/lib/apt/lists/*
COPY --from=browser /browser/dist/index.html /usr/local/share/gitterm-terminal/index.html
COPY ./custom/tmux.conf /etc/gitterm-tmux.conf
COPY ./custom/session.sh /usr/local/bin/gitterm-terminal-session
RUN chmod +x /usr/local/bin/gitterm-terminal-session
# Transport fixture intentionally runs a shell; production below requires V2.
CMD ["ttyd", "--writable", "--port", "7681", "--index", "/usr/local/share/gitterm-terminal/index.html", "tmux", "-u", "-L", "gitterm", "-f", "/etc/gitterm-tmux.conf", "new-session", "-A", "-s", "transport-test", "bash"]

# Create runtime image
FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    bash \
    tmux \
    curl \
    unzip \
    nodejs \
    npm \
    netcat-traditional \
    libjson-c5 \
    libssl3 \
    zlib1g \
    libuv1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install the AWS SAM CLI. This image currently builds for linux/amd64 because
# the ttyd artifact copied above is x86_64.
ARG AWS_SAM_CLI_VERSION=latest
RUN curl -fsSL "https://github.com/aws/aws-sam-cli/releases/${AWS_SAM_CLI_VERSION}/download/aws-sam-cli-linux-x86_64.zip" \
      -o /tmp/aws-sam-cli.zip && \
    unzip -q /tmp/aws-sam-cli.zip -d /tmp/aws-sam-cli && \
    /tmp/aws-sam-cli/install --update -i /usr/local/aws-sam-cli -b /usr/local/bin && \
    rm -rf /tmp/aws-sam-cli /tmp/aws-sam-cli.zip && \
    sam --version

# Copy the built ttyd binary from builder stage
COPY --from=builder /usr/local/bin/ttyd /usr/bin/ttyd
COPY --from=browser /browser/dist/index.html /usr/local/share/gitterm-terminal/index.html
COPY ./custom/tmux.conf /etc/gitterm-tmux.conf
COPY ./custom/session.sh /usr/local/bin/gitterm-terminal-session
RUN chmod +x /usr/local/bin/gitterm-terminal-session
COPY --from=builder /usr/lib/x86_64-linux-gnu/libwebsockets*.so* /usr/lib/x86_64-linux-gnu/

# Update library cache
RUN ldconfig

# Install OpenCode 2 globally (IMPORTANT: keep global installs OUTSIDE /workspace)
# /workspace is a persisted volume in GitTerm, so anything installed under it can disappear on mount.
# OpenCode 2 ships as @opencode/cli; the opencode-ai package stays on 1.x.
ARG OPENCODE_VERSION=2
ARG OPENCODE_INSTALL_CACHE_BUST=manual
RUN echo "opencode install cache bust: ${OPENCODE_INSTALL_CACHE_BUST}" \
    && npm cache clean --force \
    && echo "npm @opencode/cli: $(npm view @opencode/cli@${OPENCODE_VERSION} version)" \
    && npm install -g "@opencode/cli@${OPENCODE_VERSION}" "@gitterm/cli@latest" --prefer-online --no-audit --fund=false \
    && version=$(/usr/local/bin/opencode --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1) \
    && echo "installed opencode: ${version:-unknown}" \
    && case "$version" in 2.*) ;; *) echo "OpenCode 2.x is required (found ${version:-unknown})" >&2; exit 1 ;; esac

# Set up working directory
WORKDIR /workspace

# Set environment variables for persistence
# These ensure all tools store data in /workspace by default
ENV LANG=C.UTF-8 \
    HOME=/workspace \
    XDG_CONFIG_HOME=/workspace/.config \
    XDG_DATA_HOME=/workspace/.local/share \
    XDG_STATE_HOME=/workspace/.local/state \
    XDG_CACHE_HOME=/workspace/.cache \
    NPM_CONFIG_USERCONFIG=/workspace/.npmrc \
    NPM_CONFIG_CACHE=/workspace/.npm \
    PATH=/workspace/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    OPENCODE_CONFIG_DIR=/workspace/.config/opencode \
    OPENCODE_DATA_DIR=/workspace/.local/share/opencode \
    OPENCODE_CACHE_DIR=/workspace/.cache/opencode \
    HISTFILE=/workspace/.bash_history

# Copy and set up entrypoint script
COPY ./opencode/entrypoint.sh /entrypoint.sh
COPY ./workspace-setup-runner.sh /usr/local/bin/gitterm-workspace-setup
COPY ./git-credential-github.mjs /usr/local/bin/gitterm-git-credential
COPY ./runtime-bootstrap.mjs /usr/local/bin/gitterm-runtime-bootstrap
RUN chmod +x /entrypoint.sh /usr/local/bin/gitterm-workspace-setup /usr/local/bin/gitterm-git-credential /usr/local/bin/gitterm-runtime-bootstrap

# Expose the ttyd port
ENV PORT=7681
EXPOSE 7681

# Define the entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# Default command
CMD ["ttyd", "--index", "/usr/local/share/gitterm-terminal/index.html", "--interface", "::", "--ipv6", "--writable", "--port", "7681", "/usr/local/bin/gitterm-terminal-session"]

# docker build -f ./Opencode.Dockerfile --platform linux/amd64 -t opeoginni/gitterm-opencode:latest .

# docker push opeoginni/gitterm-opencode:latest
