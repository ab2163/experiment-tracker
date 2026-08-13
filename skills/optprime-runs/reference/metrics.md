# W&B metrics

## The syncing caveat (read first)

For these OptPrime runs, W&B **history frequently does not sync** to the server:
`wandb.Api().run(path).lastHistoryStep` is `-1` and `scan_history()` returns 0 rows,
even while the job logs metrics fine. **So read per-iteration metric values from the
trainer log** (monitoring.md), not from the W&B API. Summary/config fields on the run
object are usually present; the time-series often is not. If you must use the API,
verify `lastHistoryStep >= 0` before trusting `scan_history`.

## The metric the user cares about

**`train/reward/avg-turn`** — the **average reward per training iteration**. This is
the primary signal of whether the policy is improving on the task. Report its latest
value, the iteration index (`iter n/N`), and the trend.

> Do **not** confuse it with turn *count* metrics. `train/turns_per_episode` (~6 for
> Erdos) is how many turns an episode takes — a different quantity. The user
> explicitly wants `train/reward/avg-turn` (a reward), not a turn count.

Reference behaviour (a real Erdos-8B civo run): `train/reward/avg-turn` plateaued
~0.44 over iters 0–22 (range ~0.426–0.466) while the within-group reward std fell
0.61 → 0.19 — i.e. the policy was **converging without gaining reward** (a useful
"no improvement" verdict for the stage `result`).

## Common metrics and when to use them

| Metric | Meaning | Use it to… |
|---|---|---|
| `train/reward/avg-turn` | avg reward per iteration | judge learning progress (**primary**) |
| within-group reward **std** | spread of rewards across a group | see convergence (falling std) vs exploration |
| `train/turns_per_episode` | turns taken per episode | spot episodes hitting the turn/context limit |
| loss / policy-loss | optimisation objective | sanity-check training is stepping (not a quality measure) |
| KL / entropy (if logged) | divergence from ref / exploration | detect collapse (KL blow-up, entropy → 0) |
| `progress/iteration` (if present) | iteration counter | index other metrics; may be absent on skyrl runs |

Notes:
- New skyrl-style runs often **lack** `progress/epoch`/`progress/iteration`, so infer
  the iteration index from the log ordering.
- Context-window overflow warnings in the skyrl log around turn 3–4 indicate
  trajectories are getting truncated — relevant when reward stalls.

## Recording into the stage

When a run finishes, put the final metric into the stage `result` per PROTOCOLS §6,
e.g. `"avg-turn 0.44 (iter 50/50); converged, no reward gain"`. Never leave it blank —
if the metric never appeared, say so (`"avg-turn never logged; see RunFailure"`) and
file a `RunFailure` (§5).
