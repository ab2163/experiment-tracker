# Submission — `remote.submit`

## Invocation

```bash
python -m remote.submit <mode> [HYDRA OVERRIDES ...] --name NAME --cluster CLUSTER [OPTIONS]
```

- `remote.submit` is a **single-command Typer app**, so the command name is implicit
  and `<mode>` (the first positional) is `train` or `eval`.
- Returns a `JobSubmitResponse`: `.success`, `.job_id` (canonical k8s-suffixed name —
  use this for all later calls), `.cluster`, `.namespace`, `.message`, `.warnings`.
- On success it prints the exact `kubectl` lines to watch/kill the job (see
  monitoring.md).

### Mandatory
| Arg | Notes |
|---|---|
| `mode` | `train` or `eval` (positional, first). |
| `--name NAME` | Platform job name. Must be unique-ish; W&B name is set separately. |
| `--cluster CLUSTER` | `aws` \| `civo` \| `nebius` (see clusters.md; nebius has no GPUs now). |

### Common options
| Option | Default | Notes |
|---|---|---|
| `--dry-run` | off | Print the JSON payload and **skip** submission. Use for the quota gate. |
| `--branch NAME` | current branch | Git branch the job checks out. **Use `main`** for reproducible autonomous runs. |
| `--priority {low,med,high}` | `med` | Kueue tier. Governed by the §2 quota gate — do not free-choose. |
| `--env KEY=VALUE` | — | Repeatable. Inject secrets/config not in the shell env (e.g. `LANGFUSE_HOST`). |
| `--backend {skyrl,tinker}` | auto | Auto-selected from the model provider; see below. |
| `--image`, `--sidecar-image` | repo defaults | Main / SkyRL container images. |
| `--main-worker-memory-gb` | preset | Trainer orchestrator RAM (it uses **0 GPUs**). |
| `--skyrl-memory-per-gpu` | 120 | SkyRL GPU-worker RAM per GPU. |
| `--skyrl-vcpu-per-gpu` | 4 | SkyRL vCPU per GPU. |
| `--dind-memory-per-gpu` / `--dind-vcpu-per-gpu` | 30 / 16 | DinD sidecar (0 GPUs). |
| `--wandb-restore-vcpu` / `--wandb-restore-memory-gb` | 4 / 150 | Only if resuming a W&B checkpoint. |

## Backend selection

- The GPU work runs in the **SkyRL** sidecar (self-hosted GPUs). For a
  `provider=tinker` model the backend **auto-selects `skyrl`** — Tinker here is just
  the model/renderer config, not the hosted trainer.
- Pass `--backend tinker` **only** to use Tinker's *hosted* training API instead of
  our GPUs (needs `TINKER_API_KEY`). For normal cluster runs, leave it auto → skyrl.

## Hydra overrides (the physics of the run)

Config groups (base `config/train.yaml`):
- `environment=<env>` — which task (see list below). e.g. `environment=erdos`.
- `model=tinker/<model>` — e.g. `model=tinker/qwen3_8b` (`Qwen/Qwen3-8B`,
  renderer `qwen3_disable_thinking`). `qwen3_5_9b` = `Qwen/Qwen3.5-9B`. There is **no
  qwen3_5_8b**.
- `skyrl=<default|aws|civo|qwen3_8b>` — cluster/model SkyRL preset. Match to
  `--cluster` (e.g. `skyrl=civo` with `--cluster civo`).
- Scalars: `dataset.batch_size`, `dataset.group_size`, `dataset.score_cpu_budget`,
  `train.n_epochs`, `train.adam_params.lr`, `train.adv.estimator` (see
  **Advantage estimators** below), `skyrl.trainer.placement.policy_num_gpus_per_node`,
  `skyrl.generator.inference_engine.tensor_parallel_size`.
- Logging: `logging.wandb.project`, `logging.wandb.name`, `logging.wandb.mode`,
  `logging.wandb.entity`.

### Advantage estimators (`train.adv.estimator`)

The reward→advantage pipeline is `reward_transform → return_strategy → estimator`
(`train/adv/estimators.py`, enum `AdvEstimator` in `common/config_schema.py`). Each
estimator is group-relative (operates within a group of `group_size` trajectories for
one task). **There are four**, not three:

| Value | What it does |
|---|---|
| `mean_baseline` (default) | Subtract the group mean: `r - mean(r)`. Vanilla GRPO baseline. |
| `mean_std` | Standardize: `(r - mean) / (std + eps)`. GRPO-style normalization. |
| `tttd_entropic` | Entropic softmax-weighted advantage, **fixed** `train.adv.beta` (default 2.0). |
| `tttd_entropic_adaptive_beta` | Same, but `beta` is auto-tuned per group to hit a target KL (`train.adv.adaptive_delta=log2`); ignores `beta`. |

`train.adv` defaults: `reward_transform=identity`, `return_strategy=max`,
`estimator=mean_baseline`, `beta=2.0`. Changing only `train.adv.estimator` is the clean
way to A/B the estimator with everything else held fixed.

### GPU sizing per model (the `skyrl=` preset sets the GPU count)

The **`skyrl=` preset** — not the model — sets `policy_num_gpus_per_node` +
`tensor_parallel_size`, i.e. the GPUs the job requests (confirm via `--dry-run`
`sidecars[skyrl].n_gpus`):

| skyrl preset | GPUs / TP | Use for |
|---|---|---|
| `skyrl=default` | **1 GPU**, TP=1 | a model that fits one GPU — the **1-GPU budget** preset. |
| `skyrl=qwen3_5_4b`, `skyrl=qwen3_8b` | 2 GPUs, TP=2 | 4B / 8B dense (8B **OOMs on 1 GPU**). |
| `skyrl=civo`, `skyrl=aws`, `skyrl=qwen3_30b_a3b-aws` | 8 GPUs, TP=8 | 30B-class MoE on a full node. |

For a **1-GPU budget** use `skyrl=default` with a small dense skyrl model:
**`model=tinker/llama_3_2_1b`** (`meta-llama/Llama-3.2-1B`, `renderer_name=role_colon`;
its config note says *"deprecated on tinker, only use with skyrl"* — exactly our path).
The 4B/8B have 2-GPU presets; `nemotron3_nano`/`qwen3_30b_a3b*` are 30B MoE (multi-GPU).
A 1B model also leaves the most memory for a large `batch_size×group_size`, so it is
both the 1-GPU *and* the max-throughput choice.

### circle_packing sizing (validated)

`config/environment/circle_packing.yaml`: 17 train circles (`[15..34]` minus a few),
3 val, Docker scorer `opt-prime-circle-packing:latest`, `budget_s=60`, `n_cpus=1`/task.
The repo's civo max-utilization audit ran circle_packing at **`batch_size=32`,
`group_size=16`** (512 traj/iter) to "complete 100%" (avg reward 0.39→2.28). That is the
documented max B×G for the env. On a **1-GPU** job the SkyRL sidecar has ~4 vCPU + a
16-vCPU DinD, so set `dataset.score_cpu_budget≈16` (not the 128 used on 8-GPU nodes) —
scoring is the CPU-bound step (each rollout is a 60 s Docker sim).

### W&B is mandatory
`train/utils/ml_log.py` asserts that if `logging.wandb.project` is set then
**both** `logging.wandb.entity` and `logging.wandb.name` must be set (else
`AssertionError`). Defaults: `entity=orbitalmaterials`, `mode=online`. Always set an
explicit `logging.wandb.project` **and** `logging.wandb.name`.

### Langfuse is required at runtime
`rl_engine/policies.py` checks `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
`LANGFUSE_HOST`. The keys are forwarded from the shell env if present; `LANGFUSE_HOST`
usually is not, so pass `--env LANGFUSE_HOST=http://langfuse.om.private/`. Missing it
→ `ValueError: Missing Langfuse env vars: ['LANGFUSE_HOST']` (see errors.md).

## Available environments

`ale_bench, anthropic_kd_bench, arithmetic, basic_cad_coding, circle_packing,
crystal_gym, cvdp_cid07, engibench_airfoil, erdos, frontier_jobshop,
high_entropy_alloys, horizon_math, mechbench, newtonbench, openrocket, pixel_grid,
pmo, polygon_packing, qspr, quantum_error_correction, rna_seq_denoising,
synthetic_opt, uncertainty_inequality`

(Directories under `environments/` excluding `common`. Each has a
`config/environment/<env>.yaml`; most run their scorer in a Docker executor —
`erdos` uses `opt-prime-erdos:latest`, budget 60 s, 2 CPUs.)

## Known-good Erdos command (verified to run on civo)

```bash
python -m remote.submit train \
  environment=erdos model=tinker/qwen3_8b skyrl=civo \
  dataset.batch_size=4 dataset.group_size=16 dataset.score_cpu_budget=16 \
  train.n_epochs=50 train.adam_params.lr=1e-4 train.adv.estimator=mean_baseline \
  skyrl.trainer.placement.policy_num_gpus_per_node=2 \
  skyrl.generator.inference_engine.tensor_parallel_size=2 \
  logging.wandb.project=omni-tests logging.wandb.name=erdos-automated-test-2 \
  logging.wandb.mode=online \
  --name erdos-automated-test-2 --branch main --cluster civo \
  --env LANGFUSE_HOST=http://langfuse.om.private/
```

**Erdos defaults that work:** batch 4, group 16, 50 epochs, lr 1e-4,
`adv.estimator=mean_baseline`, **2 GPUs** with **TP=2** (1 GPU OOMs — see
clusters.md/errors.md). This job requests **2 GPUs**.

## The submit procedure (with the gate)

1. `source /shared/optprime-runs/env.sh`
2. Build the command for the user's request.
3. **`--dry-run`** → read `sidecars[].n_gpus` (skyrl) = GPUs this job needs.
4. Run the **quota gate** (PROTOCOLS §2 / `scripts/preflight.py`): sum the user's
   active-job GPUs, choose `--priority med`/`low`, or refuse if total > 32.
5. **Confirm with the user**, then submit for real with the chosen `--priority`.
6. Record job id, create/append the stage, link the run (PROTOCOLS §3/§6/§7).
