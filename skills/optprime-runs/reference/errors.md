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

**SkyRL-tx server never becomes healthy + ECR/AWS-creds error → crash-loop**
→ category `infra`. Signature: the trainer log repeats
`[start-trainer.sh] Waiting for SkyRL-tx server at http://localhost:8000/api/v1/healthz`
and never proceeds, alongside
`[common.settings][ERROR] AWS credentials are missing or expired. Docker image pulls
from ECR will fail. Run: aws sso login`. The SkyRL sidecar / DinD scorer images live in
AWS ECR (`242201294648.dkr.ecr.us-west-1…`); if the pod's ECR/AWS creds have lapsed the
inference server can't start, the trainer waits, the Job fails, and **k8s restarts it —
each retry spawns a fresh W&B run that also crashes**, so W&B/Omni fills with many
same-named `crashed` runs (the tell-tale of a crash-loop, not a config bug).
*Diagnosis:* it is **not** your hyperparameters if `--dry-run` was clean and pods
scheduled — check whether **other, unrelated jobs on the same cluster are completing**
(a `refresh-ecr-secret` cronjob runs every minute to keep the ECR pull-secret fresh); if
they are, the lapse was transient. *Fix:* resubmit once creds are fresh; the config is
unchanged. Record one `RunFailure` for the batch (don't write 43). Observed live
2026-08-13 on the `advantage-estimators` circle_packing batch. If it recurs when other
jobs are healthy, escalate to infra (the pod isn't getting ECR creds).

> **Why one crash → dozens of `crashed` runs:** the k8s Job's non-zero `backoffLimit`
> auto-retries the failed pod ~6× (each replacement pod re-runs `wandb.init` → a fresh
> run ID with the same display name). This is **not** a config bug and **not** you
> resubmitting; `remote.submit` can't set `backoffLimit: 0`. **When you spot a crash-loop
> (≥2 same-named `crashed` runs), cancel the Job promptly** to stop the remaining retries
> burning GPU and flooding the graph, then dedupe by `display_name` when reporting. Full
> mechanism + detection in monitoring.md → "Auto-retry (k8s `backoffLimit`)".

**Kueue admit/evict loop — "Exceeded the PodsReady timeout" (never runs a step)**
→ category `infra`. **Check `GET …/jobs/{ns}/{job_id}/events` FIRST for any failed/looping
job** — the logs alone mislead here. Signature: repeated `Resumed` / `Started` (`Admitted
by clusterQueue`) and `Stopped: Exceeded the PodsReady timeout …`, with `Suspended`
counts in the double digits and a `SuccessfulDelete pod` each cycle (observed x13, ~17 min
per cycle). Kueue admits the workload → the Job unsuspends → a pod is created → the pod
does **not** reach *Ready* within Kueue's `waitForPodsReady` timeout → Kueue **evicts** it
and re-suspends → re-queues, forever. The job **never runs a training step**, and each
admitted attempt may `wandb.init` before eviction, so this **also** manifests as many
same-named `crashed` runs (don't mistake it for a config crash). A misleading
`SkyRL-tx …healthz` wait or `AWS credentials … ECR` line in the trainer log is usually a
**symptom** (the pod was killed mid-startup), not the cause. *Diagnosis:* this is almost
always **platform-side** — a bad Kueue config/update evicting still-starting pods; it hits
multiple users' jobs at once, so **check Slack / whether unrelated jobs on the cluster are
also stuck** before touching your config. *Fix:* nothing to change in the run — **cancel
the looping jobs** (stop the churn + phantom runs), report it as a platform/Kueue issue,
and **resubmit once infra confirms Kueue is healthy**. Observed live 2026-08-13/14 on the
`advantage-estimators` civo batch, concurrent with a reported Kueue-update bug (AWS,
per Anders/Tim on Slack; civo affected too).

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
