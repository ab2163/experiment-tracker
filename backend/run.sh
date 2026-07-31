#!/usr/bin/env bash
# Backend startup: set up the virtualenv, install deps, optionally ingest runs
# from WandB, then serve the API.
#
# Usage:
#   ./run.sh              # setup + serve; ingests automatically if the DB is missing
#   ./run.sh --ingest     # force a fresh ingest before serving
#   ./run.sh --no-ingest  # skip ingest, just serve
#
# Env: PORT (default 8123). WandB config is read from .env (see .env.example).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8123}"

# Requires Python 3.9+.
if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 9) else 1)'; then
  echo "Error: Python 3.9 or newer is required (found: $(python3 --version 2>&1))." >&2
  exit 1
fi

# 1. Virtualenv + dependencies (idempotent). Uses `python -m pip`/`-m uvicorn`
#    so it works even where the venv doesn't create console scripts.
if [ ! -d .venv ]; then
  echo "Creating .venv and installing dependencies…"
  python3 -m venv .venv
  ./.venv/bin/python -m pip install --upgrade pip >/dev/null
  ./.venv/bin/python -m pip install -r requirements.txt
fi
PY=./.venv/bin/python

# 2. Config: ensure a .env exists.
if [ ! -f .env ]; then
  echo "No .env found — creating one from .env.example. Edit it to add WANDB_API_KEY." >&2
  cp .env.example .env
fi

# 3. Decide whether to ingest. Auto-ingest only when the local DB doesn't exist
#    yet (first run). Assumes the default sqlite DB path; adjust if you changed
#    DATABASE_URL. The legacy name (ablation.db) also counts as an existing DB —
#    it's auto-renamed to experiment_data.db on startup.
DB="experiment_data.db"
LEGACY_DB="ablation.db"
mode="auto"
for arg in "$@"; do
  case "$arg" in
    --ingest) mode="force" ;;
    --no-ingest) mode="skip" ;;
  esac
done

need_ingest=0
if [ "$mode" = "force" ]; then
  need_ingest=1
elif [ "$mode" = "auto" ] && [ ! -f "$DB" ] && [ ! -f "$LEGACY_DB" ]; then
  need_ingest=1
fi

if [ "$need_ingest" -eq 1 ]; then
  if grep -qE '^WANDB_API_KEY=.+' .env; then
    echo "Ingesting runs from WandB (this can take a few minutes)…"
    "$PY" -m app.ingest
  else
    echo "WANDB_API_KEY is not set in .env — skipping ingest; the app will start with an empty DB." >&2
    echo "Add your key to .env and run ./run.sh --ingest to populate it." >&2
  fi
fi

# 4. Serve.
echo "Serving API on http://127.0.0.1:${PORT}  (Ctrl-C to stop)"
exec "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
