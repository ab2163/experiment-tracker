# Pipeline basics — enough to reason about a run

This is contextual understanding, not a spec. Depth lives in the code
(`libs/opt-prime/rl_engine/`, `train/`, `remote/`, `config/`).

## The RL loop (what a "train" run does)

OptPrime does online RL on an **environment** (a task like Erdos). Each training
iteration:

1. **Rollout / generation.** For each prompt in the batch, the policy generates
   `group_size` candidate trajectories (multi-turn) via the inference engine.
2. **Score.** The environment's scorer evaluates each trajectory and returns a
   reward. Scorers usually run in a **Docker container** (e.g.
   `opt-prime-erdos:latest`) launched through the DinD sidecar; Erdos gives ~60 s /
   2 CPUs per attempt.
3. **Advantage.** Rewards within a group are turned into advantages (e.g.
   `train.adv.estimator=mean_baseline` subtracts the group mean).
4. **Policy update.** A gradient step updates the policy weights.

`n_epochs` iterations of this; metrics logged to W&B (and always to the trainer log).

## The three containers (map to log streams)

| Container | GPUs | Does |
|---|---|---|
| **trainer** (main worker) | 0 | Orchestrates the loop, computes advantages/updates, logs metrics, drives the SkyRL + env clients. Lightweight. |
| **SkyRL sidecar** | **all the GPUs** | Hosts the **policy trainer** (weight updates) and the **generator** (inference engine that samples rollouts). This is where VRAM/OOM lives. |
| **DinD sidecar** | 0 | Docker-in-Docker so the trainer can spin up the env's scorer image to compute rewards. |

**GPU count** comes only from SkyRL (`compute_skyrl_total_gpus`). With the usual
`trainer.placement.colocate_all=true`, the policy trainer and the generator **share
one GPU pool**, so total GPUs = `max(trainer_gpus, generator_gpus)` — e.g.
`policy_num_gpus_per_node=2` + a TP-2 generator colocated ⇒ **2 GPUs total**. Turn
colocation off and they need separate pools (more GPUs).

## SkyRL vs Tinker (the backend)

- **SkyRL (default for cluster runs).** Self-hosted trainer+generator on *our* GPUs.
  `provider=tinker` models still auto-select the **skyrl** backend — "tinker" there
  only names the model/renderer config, not the trainer.
- **Tinker hosted API (`--backend tinker`).** Offloads training/sampling to Tinker's
  hosted service (needs `TINKER_API_KEY`); no cluster GPUs. Rarely what you want for
  these runs.

## The `tinker` library, renderers, and clients

- The `tinker` package supplies the **token/renderer types** (`ModelInput`,
  `ModelInputChunk`, `EncodedTextChunk`) used to turn multi-turn chat into model
  input, and the client for its hosted train/sample API.
- **Renderers** (`rl_engine/renderers/`) implement each model family's chat template.
  `model=tinker/qwen3_8b` uses `qwen3_disable_thinking` (no visible chain-of-thought
  in the rendered prompt). Wrong renderer ⇒ malformed prompts / quality collapse.
- **Sampling client** = the generation/inference side (produces rollouts). **Training
  client** = the weight-update side. Under SkyRL both live in the sidecar (the
  `generator.inference_engine` and the policy trainer); under `--backend tinker` both
  are calls to the hosted API. `rl_engine/policies.py` wires the policy and enforces
  the Langfuse tracing keys.

## Where things are configured

- `config/train.yaml` — base; `config/environment/<env>.yaml` — the task;
  `config/model/tinker/<model>.yaml` — base model + renderer + provider;
  `config/skyrl/<preset>.yaml` — GPU placement, TP, engine settings per cluster/model;
  `config/logging/default.yaml` — W&B entity/project/name/mode.
