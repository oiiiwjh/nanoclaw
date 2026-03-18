#!/bin/zsh
set -eu

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

export HOME="${HOME:-/Users/jah}"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"

{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] launchd-start invoked"
  echo "HOME=$HOME"
  echo "PATH=$PATH"
  command -v docker || true
  command -v node || true
} >> "$LOG_DIR/launchd-bootstrap.log" 2>&1

cd "$PROJECT_ROOT"
exec /Users/jah/.nvm/versions/node/v22.19.0/bin/node dist/index.js >> "$LOG_DIR/nanoclaw.log" 2>> "$LOG_DIR/nanoclaw.error.log"
