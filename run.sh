#!/bin/sh
# One-command run for the autonomous agent: install deps (if needed) and run
# the full loop (read skill.md -> auth -> list -> enter -> complete -> report).
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi
exec node agent.mjs
