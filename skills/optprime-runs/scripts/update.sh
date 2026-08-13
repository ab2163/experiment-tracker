#!/usr/bin/env bash
# Atomic updater for the neutral opt-prime runtime.
#
# CONTRACT (see reference/environment.md): never mutate the live tree. Build a fresh
# releases/<ts> (clone + uv sync), VALIDATE it with a --dry-run, then flip the
# `current` symlink with an atomic rename. Readers already on the old release keep
# using it until they exit; new readers get the new one. Old releases are GC'd.
#
# Run manually, or on a schedule (cron/CronCreate) to keep opt-prime fresh. Because
# the publish step is a single atomic `ln -sfn`, concurrent submits are never torn.
set -euo pipefail
ROOT=/shared/optprime-runs
BRANCH="${1:-main}"
KEEP="${KEEP:-3}"                     # how many old releases to retain
LOG="$ROOT/logs/update.log"
mkdir -p "$ROOT/logs" "$ROOT/releases"
exec > >(tee -a "$LOG") 2>&1
echo "=== update start $(date -u +%FT%TZ) branch=$BRANCH ==="

export UV_PYTHON_INSTALL_DIR="$ROOT/.uv-python" UV_CACHE_DIR="$ROOT/.uv-cache" UV_LINK_MODE=copy
TS=$(date -u +%Y%m%dT%H%M%SZ)
REL="$ROOT/releases/$TS"
mkdir -p "$REL"

# 1. Fresh clone (shallow) of orb at the requested branch.
echo "cloning orb@$BRANCH ..."
git clone --depth 1 --branch "$BRANCH" https://github.com/orbital-materials/orb.git "$REL/orb"
git config --global --add safe.directory "$REL/orb" || true

# 2. Build the venv for opt-prime (interpreter+cache already on /shared).
cd "$REL/orb/libs/opt-prime"
uv python install 3.13.7 >/dev/null 2>&1 || true
echo "uv sync ..."
uv sync --python 3.13.7

# 3. VALIDATE: the submit CLI must import and a dry-run must succeed. If not, do NOT
#    publish — an upstream change may have broken submission; leave `current` as is.
echo "validating (dry-run) ..."
if ! .venv/bin/python -c "import remote.submit, torch, wandb" ; then
  echo "VALIDATE FAILED: imports broken — NOT publishing $REL"; exit 1
fi
if ! .venv/bin/python -m remote.submit train environment=erdos model=tinker/qwen3_8b skyrl=civo \
      logging.wandb.project=validate logging.wandb.name=validate \
      --name optprime-runs-validate --cluster civo --dry-run >/dev/null ; then
  echo "VALIDATE FAILED: dry-run errored — NOT publishing $REL"; exit 1
fi

# 4. Atomic publish.
ln -sfn "$REL" "$ROOT/current"
echo "PUBLISHED current -> $REL"

# 5. GC old releases (keep newest $KEEP, never the current target).
cur=$(readlink -f "$ROOT/current")
ls -1dt "$ROOT"/releases/*/ 2>/dev/null | tail -n +$((KEEP+1)) | while read -r old; do
  [ "$(readlink -f "$old")" = "$cur" ] && continue
  echo "gc $old"; rm -rf "$old"
done
echo "=== update done $(date -u +%FT%TZ) ==="
