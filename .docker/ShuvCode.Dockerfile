# Multi-stage build: Stage 1 - Build ttyd from source
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

# Enable Corepack for Yarn
RUN corepack enable

# Clone the ttyd repository
WORKDIR /build
RUN git clone https://github.com/tsl0922/ttyd.git

WORKDIR /build/ttyd

# Copy your custom app. tsx file to replace the original
COPY ./custom/app.tsx /build/ttyd/html/src/components/app.tsx
COPY ./custom/xterm-index.ts /build/ttyd/html/src/components/terminal/xterm/index.ts

COPY ./custom/index.scss /build/ttyd/html/src/style/index.scss

COPY ./custom/server.c /build/ttyd/src/server.c
COPY ./custom/server.h /build/ttyd/src/server.h
COPY ./custom/http.c /build/ttyd/src/http.c
COPY ./custom/protocol.c /build/ttyd/src/protocol.c

# Build the frontend first (this is crucial!)
WORKDIR /build/ttyd/html
RUN yarn install && yarn build

# Now build the backend
WORKDIR /build/ttyd
RUN mkdir build && \
    cd build && \
    cmake .. && \
    make && \
    make install

# Multi-stage build: Stage 2 - Create runtime image
FROM oven/bun:1-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    netcat-traditional \
    libjson-c5 \
    libssl3 \
    zlib1g \
    libuv1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the built ttyd binary from builder stage
COPY --from=builder /usr/local/bin/ttyd /usr/bin/ttyd
COPY --from=builder /usr/lib/x86_64-linux-gnu/libwebsockets*.so* /usr/lib/x86_64-linux-gnu/

# Update library cache
RUN ldconfig

# Install ShuvCode globally (IMPORTANT: keep global installs OUTSIDE /workspace)
# /workspace is a persisted volume in GitTerm, so anything installed under it can disappear on mount.
RUN mkdir -p /opt/bun
RUN BUN_INSTALL=/opt/bun bun add -g shuvcode@latest

# Set up working directory
WORKDIR /workspace

# Set environment variables for persistence
# These ensure all tools store data in /workspace by default
ENV HOME=/workspace \
    XDG_CONFIG_HOME=/workspace/.config \
    XDG_DATA_HOME=/workspace/.local/share \
    XDG_STATE_HOME=/workspace/.local/state \
    XDG_CACHE_HOME=/workspace/.cache \
    NPM_CONFIG_USERCONFIG=/workspace/.npmrc \
    NPM_CONFIG_CACHE=/workspace/.npm \
    # Keep Bun global install location outside the persisted /workspace volume
    BUN_INSTALL=/opt/bun \
    PATH="/opt/bun/install/global/node_modules/.bin:${PATH}" \
    OPENCODE_CONFIG_DIR=/workspace/.config/opencode \
    OPENCODE_DATA_DIR=/workspace/.local/share/opencode \
    OPENCODE_CACHE_DIR=/workspace/.cache/opencode \
    HISTFILE=/workspace/.bash_history

# Copy and set up entrypoint script
COPY ./shuvcode/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose the ttyd port
ENV PORT=7681
EXPOSE 7681
# Git status server port
EXPOSE 19418 

# Define the entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# Default command
CMD ["ttyd", "--interface", "::", "--ipv6", "--writable", "--port", "7681", "bash", "-c", "shuvcode; exec bash"]

# docker build -f ./ShuvCode.Dockerfile --platform linux/amd64 -t opeoginni/gitterm-shuvcode:latest .

# docker push opeoginni/gitterm-shuvcode:latest