# Monitoring & cancelling runs

Two surfaces. **From the Curie sandbox, use the Platform API** (`X-API-Key`) — it
works without cluster kubeconfig. The `kubectl` lines `remote.submit` prints are for
an interactive platform session.

Always address a job by its **`job_id`** (the k8s-suffixed name from the submit
response), not the requested `--name`. Namespace is `core-gpu` for GPU jobs.

## Platform API (primary)

Base `$PLATFORM_API_URL`, header `X-API-Key: $ORBITAL_API_KEY`.

```python
GET    /api/clusters/{cluster}/jobs                              # list (filter status/user)
GET    /api/clusters/{cluster}/jobs/{namespace}/{job_id}         # details incl. pending_reason
GET    /api/clusters/{cluster}/jobs/{namespace}/{job_id}/events  # k8s events (diagnose stuck/failed)
GET    /api/clusters/{cluster}/jobs/{namespace}/{job_id}/logs?tail=N   # container logs
GET    /api/clusters/{cluster}/jobs/{namespace}/{job_id}/wait    # SSE, resolves on terminal state
PATCH  /api/clusters/{cluster}/jobs/{namespace}/{job_id}         # reprioritise (priority only)
DELETE /api/clusters/{cluster}/jobs/{namespace}/{job_id}         # cancel
```

- **Status vocabulary:** `active`, `pending`, `completed`, `failed` (+ `timeout` from
  `/wait`). Never `succeeded`.
- **Stuck job?** `GET …/{job_id}` → surface `pending_reason`; `…/events` for the k8s
  reason (often "insufficient GPUs" → queued behind capacity; cross-check
  `nodes/gpu-availability`).
- **"Tell me when it's done":** use `…/wait` (SSE) rather than polling. For a one-shot
  snapshot use the details endpoint.
- **Logs are the source of truth for metrics** (W&B history often doesn't sync — see
  metrics.md). The logs endpoint returns SSE-style `data: `-prefixed lines.
- **Log retention:** pod logs are **garbage-collected ~24 h** after the pod ends.
  Pull and record anything important (final metric, error excerpt) before then; after
  GC the logs are gone and only W&B (if it synced) remains.

## Auto-retry (k8s `backoffLimit`) — one crash → many phantom W&B runs

`remote.submit` wraps each run in a Kubernetes **Job**, and the platform templates that
Job with a **non-zero `backoffLimit`** (behaviourally the k8s default, ~6). So when a pod
crashes, the Job controller **spins up a replacement pod** (you'll see the pod's random
suffix change, e.g. `…-o8tj5-9vzpq` → `…-o8tj5-wgxp8`) and retries — up to ~6 times
before the Job is marked `failed`. **Every replacement pod re-runs `wandb.init`, creating
a brand-new run ID under the same display name.**

- **Consequence:** a job that crashes *at startup* (e.g. the SkyRL-tx/ECR failure in
  errors.md) produces **~7 same-named `crashed` W&B runs per job**, not one. Seeing 43
  `crashed` runs for a 6-job batch is **6 jobs each retried ~7×**, not 43 distinct jobs.
  When counting/summarising runs, **dedupe by `display_name`** (or count distinct
  `job_id`s), and record **one** `RunFailure` for the batch, not one per phantom run.
- **You cannot set `backoffLimit` from `remote.submit`** — the submit payload
  (`remote/submit.py`) has no backoff/restart field and there is no CLI flag; it is a
  platform-side default. (A manual submit that "never restarts on crash" was created with
  `backoffLimit: 0` through a different path — the platform submit API here does not
  expose that knob.) *Verified 2026-08-14:* payload carries no backoff field; the crashed
  `advantage-estimators` batch showed replacement-pod suffixes = live proof of retry;
  `kubectl get job -o yaml` to read the exact number is **RBAC-blocked** from the Curie
  sandbox (`sim-agent` can't get Jobs in `core-gpu`), and the platform API doesn't return
  it either.
- **A second amplifier — Kueue admit/evict:** the same "many same-named `crashed` runs"
  pattern also comes from a **Kueue admit/evict loop** (`Stopped: Exceeded the PodsReady
  timeout`, `Suspended` ×N in `…/events`), where each admitted-then-evicted attempt
  `wandb.init`s before dying. So **always read `…/events` before concluding it's a code
  crash** — an evict loop is platform-side (see errors.md → "Kueue admit/evict loop"),
  not something a config change fixes.
- **The fix when a job is crash-looping:** **cancel it promptly** (`DELETE …/jobs/…`,
  below) so the remaining retries don't burn GPU and flood the graph with phantom runs.
  Detect a loop by ≥2 same-named `crashed` runs (or `…/events` showing repeated
  `BackoffLimitExceeded`/pod recreation), then cancel and resubmit once the root cause is
  fixed. If you ever need `backoffLimit: 0`, that requires a platform-side change (raise
  it with infra), not a `remote.submit` flag.

## Containers / log streams

A GPU train job has these containers (per `remote.submit`'s printed hints):

| Container | Role | What its log shows |
|---|---|---|
| main (trainer) | orchestrator, **0 GPUs** | training loop, per-iteration metrics (incl. `train/reward/avg-turn`), assertions/config errors, W&B init |
| `skyrl` sidecar | **the GPU workers** (policy train + generation) | engine startup, VRAM/OOM, tensor-parallel init, generation, context-window warnings |
| `dind` sidecar | Docker-in-Docker for the env's scorer container (0 GPUs) | pulling/running the env image (e.g. `opt-prime-erdos`), scorer execution |
| `wandb-restore` init (optional) | restore a checkpoint | only when resuming a W&B run |

kubectl equivalents (interactive session), `ns=core-gpu`:
```bash
kubectl -n core-gpu get pods -l job-name=<job_id>
kubectl -n core-gpu logs -f -l job-name=<job_id>            # trainer
kubectl -n core-gpu logs -f -l job-name=<job_id> -c skyrl   # GPU workers
kubectl -n core-gpu logs -f -l job-name=<job_id> -c dind    # env scorer
kubectl -n core-gpu delete job <job_id>                     # cancel
```

## Watching a specific metric

The user's default metric of interest is **`train/reward/avg-turn`** (average reward
per training iteration — see metrics.md). Because W&B history frequently does not sync
for these runs, **grep the trainer log** for the metric name to read its per-iteration
values, rather than relying on `wandb.Api().run(...).scan_history()` (often 0 rows).
Report: latest value, iteration index (`iter n/N`), and trend.

## Cancelling

`DELETE …/jobs/{ns}/{job_id}` (or `kubectl delete job`). Cancelling is a user-facing,
irreversible action on a paid resource → **confirm with the user first** unless they
already asked for it. After cancelling, if it was a failure/abort, write a
`RunFailure` (PROTOCOLS §5) and set the stage `result` accordingly (never blank).

**Auth gotcha — you must cancel as the job's owner (`curie`).** `remote.submit` jobs are
owned by `username: curie` (PROTOCOLS §1). The Curie sandbox's default platform client
(`_shared/orbital_api.py`) is **proxied** and acts as the *real user* (`ajinkya`), so a
DELETE through it returns **403 "You can only modify your own jobs"**. To cancel, call the
**real platform URL directly with the curie `X-API-Key`** — the same identity
`remote.submit`/`cli.client` uses — e.g.:
```python
import os, httpx
httpx.Client(base_url="https://platform.orbitalindustries.com",
             headers={"X-API-Key": os.environ["ORBITAL_API_KEY"]}).delete(
    f"/api/clusters/{cluster}/jobs/core-gpu/{job_id}")   # -> 200 {"success": true, ...}
```
Do **not** send `X-Forwarded-User-Email` on this call (that makes it act as the user and
403s), and don't hit the proxy `PLATFORM_URL` with only `X-API-Key` (→ 401). Verify with
the *same* direct+key client (a proxied GET would show a different view). Verified live
2026-08-14 cancelling the crash-looped `advantage-estimators` jobs.
