FROM node:24-bookworm-slim

ARG PI_VERSION
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git tmux \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.$(uname -m)" \
    && chmod +x /usr/local/bin/ttyd \
    && npm install -g --ignore-scripts --no-audit --fund=false "@earendil-works/pi-coding-agent@${PI_VERSION:?Set PI_VERSION}"
