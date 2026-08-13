# Clusters

Three clusters are registered on the Orbital Platform. GPU jobs run in namespace
`core-gpu` (CPU-only jobs in `core-cpu`). **Specs below are static; availability is
live — always re-query before submitting** (see bottom).

Snapshot captured 2026-08-13 via the platform API.

## Per-cluster specs

### aws — "AWS EKS" (H100)
- **GPU nodes:** `ml.p5.48xlarge`, **8 × NVIDIA H100 80 GB** each.
- **Per GPU node:** 192 vCPU, ~2000 GiB RAM, 8 GPUs, **80 GB per GPU**.
- **Node IDs:** `hyperpod-i-<hex>` (7 whole 8-GPU nodes = 56 GPUs), plus one
  MIG-split node `hyperpod-i-04fc26ec13be90f94` exposing 24 × `mig-2g.20gb`
  (20 GB slices) — for small/eval work, not 8B colocated training.
- Also many CPU-only helper nodes (`t3.*`, `m4.16xlarge`).
- Tends to be **busy** (whole-GPU availability often low; large pending queue).

### civo — "Civo" (H200)
- **GPU nodes:** `an.g1.h200sxm.kube.x8`, **8 × NVIDIA H200 141 GB** each.
- **Per GPU node:** 176 vCPU, ~1378 GiB RAM, 8 GPUs, **141 GB per GPU**.
- **Node IDs:** `k3s-orb-civo-2-6ae5-926c8e-node-pool-eca4-<suffix>` (8 nodes = 64 GPUs).
- H200 > H100 on VRAM (141 vs 80 GB) — **preferred for larger models / when a
  model OOMs on aws.** The successful Erdos-8B run used civo.

### nebius — "Nebius"
- Registered/connected but **currently 0 GPU nodes** (no schedulable GPUs at
  snapshot). Treat as unavailable for GPU work unless a live check shows otherwise.

## Quick reference

| Cluster | GPU | VRAM/GPU | GPUs/node | vCPU/node | RAM/node | Whole GPUs |
|---|---|---|---|---|---|---|
| aws | H100 | 80 GB | 8 | 192 | ~2000 GiB | 56 (+24 MIG 20 GB) |
| civo | H200 | 141 GB | 8 | 176 | ~1378 GiB | 64 |
| nebius | — | — | — | — | — | 0 |

## GPU sizing guidance (opt-prime RL)

- **8B model, colocated train+infer:** ≥ 2 GPUs. **1 GPU OOMs** even on 141 GB H200.
  The safe default is `policy_num_gpus_per_node=2`, `tensor_parallel_size=2`.
- Larger models / bigger batch·group → more GPUs (respect the §2 quota: 16 at `med`,
  32 hard cap).
- Prefer **civo (H200)** when memory is the constraint; **aws (H100)** when civo is
  full and the model fits in 80 GB.

## Live availability (query every time)

```python
GET /api/clusters                                  # which clusters are connected
GET /api/clusters/{cluster}/nodes/gpu-availability # whole/split GPUs free right now
GET /api/clusters/{cluster}/nodes                   # per-node cpu/mem/gpu capacity + gpu_type
GET /api/clusters/{cluster}/queues/pending          # how deep the Kueue backlog is
```
Auth header `X-API-Key: $ORBITAL_API_KEY`, base `$PLATFORM_API_URL`. If
`available_whole_gpus` is 0 and `pending_whole_gpus` is high, a `med` job will queue;
tell the user and consider the other cluster.
