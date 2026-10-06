#!/bin/sh
# Runs the Slack or Discord bot: named as the first argument, or picked from whichever token is set.
set -e

case "$1" in
  slack | discord)
    platform="$1"
    shift
    ;;
  *)
    if [ -n "$SLACK_BOT_TOKEN" ]; then
      platform=slack
    elif [ -n "$DISCORD_BOT_TOKEN" ]; then
      platform=discord
    elif [ -f .env ] && grep -q '^SLACK_BOT_TOKEN=.' .env; then
      platform=slack
    elif [ -f .env ] && grep -q '^DISCORD_BOT_TOKEN=.' .env; then
      platform=discord
    else
      echo "Set SLACK_BOT_TOKEN or DISCORD_BOT_TOKEN, or run with 'slack' or 'discord' first." >&2
      exit 1
    fi
    ;;
esac

exec bun "/app/$platform.js" "$@"
