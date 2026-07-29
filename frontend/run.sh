#!/usr/bin/env bash
# Frontend dev server: installs deps on first run, then starts Vite.
# Serves the UI on http://localhost:5173 and proxies /api to the backend
# (default http://localhost:8123 — start it with ../backend/run.sh).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm (Node.js) is required. Install Node 20+ from https://nodejs.org and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies…"
  npm install
fi

echo "Starting Vite on http://localhost:5173  (Ctrl-C to stop)"
echo "Make sure the backend is running too:  cd ../backend && ./run.sh"
exec npm run dev
