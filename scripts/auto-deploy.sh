#!/usr/bin/env bash
#
# auto-deploy.sh — Check for new commits on origin/main and deploy if needed.
# Designed to run via LaunchAgent on a schedule (e.g., every 5 minutes).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_TAG="[auto-deploy]"

export PATH="/opt/homebrew/bin:$HOME/Library/pnpm:$HOME/.volta/bin:/usr/local/bin:$PATH"

cd "$PROJECT_DIR"

git fetch origin main --quiet 2>/dev/null

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "$LOG_TAG New commits detected (local=$LOCAL remote=$REMOTE), deploying..."
"$SCRIPT_DIR/deploy.sh"
echo "$LOG_TAG Deploy complete."
