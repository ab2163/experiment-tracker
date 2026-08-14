# Activate the persistent, neutral opt-prime runtime.
#   source /shared/optprime-runs/env.sh
# Keeps uv's interpreter + cache on /shared so nothing is lost on sandbox recycle,
# and always uses the atomically-published `current` release. Reading/executing this
# concurrently from many agents is safe; only update.sh ever writes (into a new
# release), so it never tears a reader.
ROOT=/shared/optprime-runs
export UV_PYTHON_INSTALL_DIR="$ROOT/.uv-python"   # interpreter on shared storage
export UV_CACHE_DIR="$ROOT/.uv-cache"             # wheel cache on shared storage
export UV_LINK_MODE=copy                          # avoid cross-fs hardlink empty-dir bug

if [ ! -e "$ROOT/current" ]; then
  echo "optprime-runs: no published release at $ROOT/current — run scripts/update.sh" >&2
  return 1 2>/dev/null || exit 1
fi
cd "$ROOT/current/orb/libs/opt-prime" || { echo "optprime-runs: current release missing opt-prime" >&2; return 1 2>/dev/null || exit 1; }

# Self-heal: refetch the shared interpreter (fast, ~2s) if a recycle removed it.
if [ ! -x .venv/bin/python ]; then
  uv python install 3.13.7 >/dev/null 2>&1 || true
fi

# `remote.submit` runs `git rev-list origin/main..main` to diff the branch. The release
# dir is owned by the uid that ran update.sh, so git's dubious-ownership guard aborts the
# submit for any other activating agent. Whitelist the resolved orb repo (path rotates per
# release) as safe. Idempotent: only add if not already present, so ~/.gitconfig can't grow.
ORB_REAL="$(cd "$ROOT/current/orb" && pwd -P)"
git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$ORB_REAL" || \
  git config --global --add safe.directory "$ORB_REAL"

source .venv/bin/activate
echo "optprime-runs: activated $(readlink -f "$ROOT/current") | python=$(python -V 2>&1)"
