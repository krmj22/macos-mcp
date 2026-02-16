#!/usr/bin/env bash
#
# deploy.sh — Pull latest code, build, and restart the MCP server.
#
# Usage:
#   ./scripts/deploy.sh              # Run locally on the server machine
#   ssh your-server './Projects/macos-mcp/scripts/deploy.sh'  # Run remotely
#
# Prerequisites:
#   - pnpm installed and in PATH
#   - LaunchAgent com.macos-mcp.server configured
#   - Git remote configured (origin)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.macos-mcp.server"

# Ensure PATH includes common install locations
export PATH="/opt/homebrew/bin:$HOME/Library/pnpm:$HOME/.volta/bin:/usr/local/bin:$PATH"

cd "$PROJECT_DIR"

echo "==> Pulling latest from origin..."
git pull --ff-only

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Building..."
pnpm build

echo "==> Restarting LaunchAgent ($LABEL)..."
if launchctl print "gui/$(id -u)/$LABEL" &>/dev/null; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
else
  echo "    LaunchAgent not loaded, skipping restart."
fi

# Wait for server to come up
sleep 2

echo "==> Health check..."
if curl -sf http://localhost:3847/health >/dev/null 2>&1; then
  HEALTH=$(curl -s http://localhost:3847/health)
  echo "    OK: $HEALTH"
else
  echo "    WARNING: Health check failed (server may not be running in HTTP mode)"
fi

echo "==> Deploy complete ($(git log -1 --format='%h %s'))"
