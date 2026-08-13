# Error playbook

For each failure below: apply the fix, and **write a `RunFailure`** (PROTOCOLS §5)
with the matching `category`. Never let a failure go unrecorded.

## Submission-time (before the job runs)

**`AssertionError` in `train/utils/ml_log.py` (`assert wandb_entity and wandb_name`)**
→ category `config`. You set `logging.wandb.project` but not `logging.wandb.name`
(and/or entity). Fix: add `logging.wandb.name=<name>` (entity defaults
`orbitalmaterials`). W&B project ⇒ name is mandatory.

**`ValueError: Missing Langfuse env vars: ['LANGFUSE_HOST']`** → category `secret`.
The policy requires `LANGFUSE_PUBLIC_KEY/SECRET_KEY/HOST`. Keys are forwarded from the
shell env; HOST usually isn't. Fix: `--env LANGFUSE_HOST=http://langfuse.om.private/`.

**`KeyError: 'WANDB_API_KEY'` / auth errors** → category `secret`. `WANDB_API_KEY`
not in the submit env. Ensure it's exported before submit (env.sh notes which secrets
are forwarded). For an ungated model, W&B + Langfuse-host are the only hard
requirements.

**Git "dubious ownership"** → category `infra`. Run
`git config --global --add safe.directory <repo>` (already handled for the neutral
release; only bites ad-hoc clones).

**Hydra override errors** (unknown group/key) → category `config`. Check the override
against submission.md's groups; `--dry-run` surfaces config resolution without
launching.

## Runtime (after the job starts)

**`torch.OutOfMemoryError: CUDA out of memory`** → category `oom`. The model/batch
doesn't fit the GPU allotment. Fixes, in order:
1. **More GPUs** — 8B colocated needs **≥2** (`policy_num_gpus_per_node=2`,
   `tensor_parallel_size=2`). **1 GPU OOMs even on a 141 GB H200.**
2. **Bigger-VRAM cluster** — move aws(H100 80 GB) → **civo(H200 141 GB)** (also flip
   `skyrl=civo`).
3. Reduce `dataset.batch_size` / `group_size`, or shorten max context.
   Respect the §2 quota when adding GPUs.

**Context-window overflow warnings (skyrl log, ~turn 3–4)** → category `other`
(note, not always fatal). Trajectories are being truncated; relevant if reward
stalls. Consider fewer turns or a longer context if the env allows.

**Job "stopped after a few minutes"** → check `…/events` and the skyrl log. Common:
OOM (above), a scorer/DinD image pull failure (category `infra`), or preemption of a
`low`-priority job (category `quota`/`infra` — it can requeue).

## W&B / discovery

**Run doesn't appear on W&B immediately** → normal. It can take a minute or two after
the job starts for the run to register. Find it under entity `orbitalmaterials`,
project = your `logging.wandb.project`, name = your `logging.wandb.name` (W&B may
append a host suffix, so match `name` or `name-*`).

**Metrics not on W&B even though the job logs them** → the history-sync caveat
(metrics.md). Read values from the trainer log; don't block on the W&B API.

**Logs gone** → pod logs are GC'd ~24 h after the pod ends (monitoring.md). If a user
asks about an old job and the logs are gone, say so and fall back to W&B summary /
any `RunFailure` already recorded.

## Quota

**User at/over the GPU cap** → category `quota`. If current+requested > 32, **refuse**
(PROTOCOLS §2), list their active jobs, and write a `RunFailure` with `resolution`
telling them what to free. If in 17–32, submit `low` and tell them it's preemptible.

## Priority / queueing

**`med` job stuck pending** → capacity. Check `nodes/gpu-availability` and
`queues/pending`; suggest the other cluster or waiting. A `low` job behind a full
cluster may wait a long time or be preempted — set expectations.
