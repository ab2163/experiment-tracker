---
name: optprime-runs
description: >-
  Submit, monitor, record, and troubleshoot OptPrime RL training runs (Erdos and
  the other opt-prime environments) on Orbital's GPU clusters on behalf of a
  tracker user, and write the result into the experiment_tracker_core Omni graph.
  Use whenever a user of the Experiment Tracker asks to launch a run, check on a
  running job, cancel one, or record a finished run as an experiment stage. Holds
  the persistent knowledge (cluster specs, submission syntax, monitoring, the
  pipeline, metrics, error playbook) and the machine-checkable PROTOCOLS that
  govern autonomous submission (ownership, per-user GPU limits, traceability,
  failure logging).
---

# OptPrime autonomous runs

This skill lets an agent take a tracker user's request — *"run Erdos on civo"* — and
carry it out end-to-end **as that user**: build the command, enforce the resource
limits, submit, monitor the right metric, and record everything back into the Omni
graph so it is traceable. It exists so the agent does **not** have to re-derive
submission/monitoring details from the orb repo every time.

**Mode: assisted (option A).** A human asks in chat; the agent executes with this
knowledge. This is *not* an unattended cron. Every live submit launches real,
paid GPU jobs, so the agent confirms with the user before the real (non-dry-run)
submit, exactly as it would without this skill.

## The five hard rules (the contract)

These are non-negotiable and are specified precisely, with checks, in
**[PROTOCOLS.md](PROTOCOLS.md)** — the inspectable contract with the system
designer. Never submit without honouring all five:

1. **Ownership.** The run's owner (`created_by` on every graph node created for it)
   is the **user who asked**, never Omni/a service account. Identity is forwarded,
   not invented. → PROTOCOLS §1
2. **Resource limits.** Per user, across active jobs: **≤16 GPUs at `med` priority,
   the next 16 GPUs only at `low` priority, hard stop at 32.** A pre-submit gate
   computes current usage + this job's GPUs and picks the tier or refuses.
   → PROTOCOLS §2
3. **Traceability of runs.** At submit time the run is linked to its experiment
   **stage** (`run_ids`). → PROTOCOLS §3
4. **Traceability of commands.** On completion the exact command is saved into the
   **`Omni-commands`** folder and linked to the stage (`command_ids`).
   → PROTOCOLS §4
5. **Nothing forgotten.** Every failure/anomaly is written to the central
   **failure log** (`RunFailure` nodes) with cause and resolution. → PROTOCOLS §5

Stage field formats (no field ever left blank, documented limits) are in
PROTOCOLS §6; the experiment create-vs-update rule in §7.

## The core loop (assisted run)

1. **Understand the request** → environment, model, cluster, any overrides, and
   which experiment it belongs to.
2. **Activate the runtime.** `source /shared/optprime-runs/env.sh` (neutral,
   persistent venv; never rebuild per-run). → [reference/environment.md](reference/environment.md)
3. **Build the command.** → [reference/submission.md](reference/submission.md)
4. **Resource gate + dry-run.** Run with `--dry-run`, read the skyrl sidecar
   `n_gpus`, run the quota check (PROTOCOLS §2), decide `--priority`, or refuse.
5. **Confirm with the user, then live submit.**
6. **Create/append the experiment stage** and link the run (PROTOCOLS §3, §6, §7).
7. **Monitor** the run and the metric the user cares about (default
   `train/reward/avg-turn`). → [reference/monitoring.md](reference/monitoring.md),
   [reference/metrics.md](reference/metrics.md)
8. **On finish:** update the stage `result`, save + link the command
   (PROTOCOLS §4). **On failure:** apply the playbook
   ([reference/errors.md](reference/errors.md)) and write a `RunFailure`
   (PROTOCOLS §5).

## Reference index

| File | What's in it |
|---|---|
| [PROTOCOLS.md](PROTOCOLS.md) | **The contract.** Ownership, resource limits, run/command linking, failure log, stage field formats, experiment create/update. |
| [reference/environment.md](reference/environment.md) | Neutral persistent venv, `env.sh`, atomic release layout, concurrency rules. |
| [reference/clusters.md](reference/clusters.md) | Live cluster specs: node IDs, CPU/RAM/GPU per node, GPU RAM, availability. |
| [reference/submission.md](reference/submission.md) | `remote.submit` syntax, mandatory/optional args, environments, Erdos defaults, backends. |
| [reference/monitoring.md](reference/monitoring.md) | kubectl + platform API, the log streams (trainer/skyrl/dind), cancel, timing. |
| [reference/pipeline.md](reference/pipeline.md) | Trainer / SkyRL / DinD containers, Tinker API, sampling & training clients. |
| [reference/metrics.md](reference/metrics.md) | W&B metric glossary, what each means, when to use it, the syncing caveat. |
| [reference/errors.md](reference/errors.md) | OOM, Langfuse, wandb-name, finding the run on W&B, log GC, quota. |

## Runtime & source locations

- **Persistent runtime** (venv + orb clone): `/shared/optprime-runs/current/…`
  (neutral, shared, atomically updated). See environment.md.
- **Canonical skill source** (this contract, version-controlled/inspectable):
  `ablation-tracker/skills/optprime-runs/` in `github.com/ab2163/experiment-tracker`.
- **Target graph:** Omni schema `experiment_tracker_core`, subgraph `default`.
