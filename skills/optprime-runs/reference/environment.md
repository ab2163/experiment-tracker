# Environment — the persistent, neutral runtime

## TL;DR

```bash
source /shared/optprime-runs/env.sh      # activates the shared venv; ~instant
cd /shared/optprime-runs/current/orb/libs/opt-prime
python -m remote.submit train ... --dry-run
```

Never rebuild the venv per run. It already exists, on shared storage, and survives
sandbox recycles.

## Why this exists

The interactive sandbox wipes `/root` on every recycle. `uv` installs the Python
interpreter and its wheel cache under `/root` by default, so a venv on `/shared`
would lose its interpreter and look "broken", forcing a slow rebuild (a full
`uv sync` once hung for ~10 min and was killed by a recycle). The fix: put the
interpreter and cache on `/shared` too, so nothing is ephemeral.

## Neutral location & atomic layout

Everything lives under a **user-neutral** root so any user's assisted session can
use it (not buried under one person's workspace):

```
/shared/optprime-runs/
  current -> releases/<ts>        # atomic symlink; readers always use this
  releases/<ts>/orb/...           # a full orb clone incl libs/opt-prime/.venv (built)
  .uv-python/                     # shared CPython 3.13.7 interpreter (stable)
  .uv-cache/                      # shared wheel cache
  env.sh                          # source this
  update.sh                       # atomic updater (see below)
  logs/                           # updater log + (optional) local failure log
```

**Atomicity (the design decision).** Updates never mutate the live tree in place.
`update.sh` builds a **new** `releases/<ts>` (fresh clone + `uv sync`), validates it
with a `--dry-run`, then flips `current` with `ln -sfn` — a single atomic rename on
the same filesystem. A submit that already resolved `current` keeps using the old
release's inode until it exits; new submits pick up the new one. Old releases are
GC'd after a grace period. So **reads and updates never tear each other**.

## Concurrency — can multiple agents use it at once?

**Yes, for reading/executing — that is safe and unlimited.** Importing the shared
`.venv`/interpreter over NFS is a read; many processes can do it simultaneously.
And `remote.submit` only *packages and submits* — the heavy compute runs on the
cluster (SkyRL/DinD), not in the venv — so concurrent submits are cheap.

**The only hazard is writing while reading.** That is confined to `update.sh`, and
the release+symlink swap above makes even that safe. Rule: **never run
`uv sync`/`pip install`/`git pull` against `current` directly.** All mutation goes
through `update.sh` into a fresh release.

## env.sh (what it does)

```bash
export UV_PYTHON_INSTALL_DIR=/shared/optprime-runs/.uv-python   # interpreter on /shared
export UV_CACHE_DIR=/shared/optprime-runs/.uv-cache             # cache on /shared
export UV_LINK_MODE=copy                                        # avoid cross-fs hardlink bug
cd /shared/optprime-runs/current/orb/libs/opt-prime
# self-heal: refetch the interpreter (fast, ~2s) if a recycle ever removed it
[ -x .venv/bin/python ] || uv python install 3.13.7
source .venv/bin/activate
```

`UV_LINK_MODE=copy` matters: across filesystems `uv`'s default hardlink fallback can
leave empty package dirs (this bit us with `multiprocess`/`typer`). Copy mode is
correct on NFS.

## Secrets forwarded to the job

`remote.submit` forwards these from the shell env **if present** (see submission.md):
`WANDB_API_KEY`, `HF_TOKEN`, `TINKER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`. Anything missing can be
supplied with `--env KEY=VALUE`. For skyrl + an ungated model (e.g. Qwen3-8B) only
`WANDB_API_KEY` and `LANGFUSE_HOST` are strictly required. Never write secrets into
files under the skill or the graph.

## Filesystem trust note

`/shared` is a shared NFS mount; all sandboxes run as the same uid and paths are
world-readable. So this neutral runtime is reachable by any user's session by design
— but that also means there is **no** cross-user isolation on `/shared`. Never place
secrets or private data here.
