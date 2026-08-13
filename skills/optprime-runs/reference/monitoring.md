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
