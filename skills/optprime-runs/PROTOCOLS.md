# PROTOCOLS — the contract for autonomous OptPrime runs

This file is the **contract** between the autonomous agent and the system designer
(the tracker owner + the Curie team). It is deliberately precise and inspectable:
every rule states *what* must hold and *how to check it*, so a reviewer can audit
whether the agent complied. If a rule cannot be satisfied, the agent **stops and
tells the user** rather than proceeding.

Target graph everywhere below: Omni schema `experiment_tracker_core`, subgraph
`default`. Verified endpoints (helper:
`sys.path.insert(0, '.claude/skills/omni'); from omni_api import make_request`,
signature `make_request(method, path, params=None, body=None, files=None)` — pass
mutation payloads as **`body=`**, not positionally):

- **List/query nodes:** `GET .../subgraphs/default/nodes?node_type=<T>&limit=200`
  → `{items, next_cursor, total_count}`; page with `cursor=<next_cursor>`.
- **Node detail:** `GET .../subgraphs/default/nodes/{id}` →
  `{id, type, title, properties, created_by, created_at, ...}`.
- **Mutate:** `POST .../subgraphs/default/mutations` with
  `body={"deltas": [...]}` (`create_node` / `update_node` / `delete_node`).
  `create_node` needs top-level `title` + `properties`; `create_node` returns
  `{refs: {ref: uuid}}`. `update_node` uses flat `updates`.

`RunFailure` node type and the `Omni-commands` folder
(`019ffc36-a2b1-79a2-aa41-e5ca02a8e583`) already exist in the live schema.

---

## §1 Ownership — the run belongs to the human, not Omni

**Rule.** Every graph node created while servicing a request (the `Stage`, any new
`Experiment`, any `RunFailure`, saved `SavedCommand`) is owned by **the user who
made the request**. The owner is the server-set `created_by` field, which in this
deployment is the requesting user's email. Omni must never appear as the owner.

**How it works.** `created_by` is set server-side from the forwarded viewer/user
identity — the same identity the `platform` skill forwards as
`X-Forwarded-User-Email` (derived from `CURIE_USER_EMAIL`). The agent does not set
`created_by` by hand; it must simply **act under the requesting user's session**
and never launch these mutations from a background/service context that would
attribute them to a bot. **Verified:** a node created from the assisted session came
back with `created_by == ajinkya@orbitalindustries.com` (the real user email), so
this rule holds automatically in normal chat use.

**Check.** After creating the stage, read it back and assert
`created_by == <requesting user email>`. If it is null or a service account, the
ownership rule is violated — delete the node and surface the problem.

**Job attribution.** The platform job itself is likewise submitted under the user's
forwarded identity (cost + audit attributed to them), never a generic key.

---

## §2 Resource limits — per-user GPU quota (HARD)

**Policy (set by the owner).**

| Cumulative GPUs the user holds (active jobs + this one) | Action |
|---|---|
| 1 – 16 | Submit at `--priority med` (default tier). |
| 17 – 32 | Submit at `--priority low` **only**. |
| > 32 | **Refuse.** Do not submit. Tell the user they are at the cap. |

"GPUs held" = the sum of GPU-bearing containers across the user's **active**
(pending or running) jobs on **all** clusters. Only the SkyRL sidecar carries GPUs;
the main trainer and DinD sidecars are 0-GPU (see pipeline.md).

**How to compute this job's GPU count.** Run the command with `--dry-run` and read
the `sidecars[].n_gpus` for the skyrl sidecar in the emitted JSON. (Equivalent:
`compute_skyrl_total_gpus(cfg)` — for the usual `colocate_all` placement it is
`max(trainer_gpus, generator_gpus)`, e.g. `policy_num_gpus_per_node ×
policy_num_nodes` when the generator is colocated.)

**How to compute current usage.** List the user's active jobs via the platform API
per cluster and sum their GPU requests:
```
GET /api/clusters/{cluster}/jobs        # filter to status active|pending, this user
```
attributing by the forwarded user identity. (`scripts/preflight.py` implements the
full gate: dry-run → parse GPUs → sum active → choose tier or refuse.)

**Decision.** Let `have` = current usage, `need` = this job's GPUs.
- `have + need ≤ 16` → `--priority med`.
- `16 < have + need ≤ 32` → `--priority low`, and tell the user it is low-priority
  (preemptible, may queue).
- `have + need > 32` → refuse; list their active jobs so they can free capacity.

**Check.** The chosen `--priority` on the real submit must match the tier the gate
selected. Never submit `med` when the gate said `low`, and never submit at all when
the gate said refuse. Record the gate decision in the stage `detail`.

> Priority is changeable in place afterwards (`PATCH .../jobs/.../ …` reprioritise)
> to bump a `low` job to `med` when the user's usage drops — but the *initial* tier
> must obey the table.

---

## §3 Run ↔ stage linking at submit time

**Rule.** When the job is submitted live, the run is linked to its experiment
`Stage` immediately via the stage's `run_ids` array — not deferred to completion.

**Mechanism.** The graph models run membership as a **property**, not an edge (the
Omni page bridge cannot create edges). The run's Omni node key is its `wandb_id`
(`entity/project/run_id`). At submit:
- If the Run node already exists in the graph, put its uuid in `Stage.run_ids`.
- If it does not yet exist (typical — W&B has not registered it), record the
  **expected wandb path** in `Stage.details` (see §6) and add the run to `run_ids`
  once it appears (the tracker's own reconcile, or a follow-up `update_node`).

**Check.** After submit, `Stage.run_ids` is non-empty *or* `Stage.details` contains
the expected `entity/project/name` so the link can be completed. A stage with
neither is a violation.

---

## §4 Command traceability — the `Omni-commands` folder

**Rule.** When a run **finishes** (or is deliberately kept), the exact command used
is saved as a `SavedCommand`, placed in a root-level `Folder` named **`Omni-commands`**
(kind `command`), and linked to the stage via `Stage.command_ids`.

**Mechanism.**
1. Ensure the folder exists: find a `Folder` with `name == "Omni-commands"`,
   `kind == "command"`, `parent_folder_id == null`; create it if missing (owned by
   the user, §1).
2. Create a `SavedCommand` — `name` = a stable label
   (`<env>-<model>-<cluster>-<YYYYMMDD>`), `command` = the full verbatim command,
   `folder_id` = the Omni-commands folder uuid.
3. Append the SavedCommand uuid to `Stage.command_ids`.

**Why a copy, not a reference.** Saved into a dedicated folder so the audit trail is
immutable even if the user reorganises their own commands.

**Check.** A completed stage has ≥1 entry in `command_ids`, and that command lives
under the `Omni-commands` folder.

---

## §5 Central failure log — nothing is forgotten

**Rule.** Every failure, refusal, or anomaly is written as a `RunFailure` node so it
is retrospectable in the graph (not just buried in chat or GC'd logs).

**When to write one:** submission error; job crash/OOM/timeout; a quota **refusal**
(§2 > 32); a metric that never appears; W&B never registering the run; a Langfuse/
config/secret blocker; anything the user had to be told "this didn't work".

**`RunFailure` fields** (all populated, see §6 for limits):
- `summary` (titleField) — one line, what failed.
- `category` — one of `oom | timeout | crash | config | secret | quota | wandb | infra | other`.
- `job_name`, `cluster`, `command` — context to reproduce.
- `error_excerpt` — the salient log/exception lines (trimmed).
- `occurred_at` — ISO datetime.
- `resolution` — what was done / what the user should do next (never blank; use
  `"open"` if unresolved).
- `stage_id` — the related Stage uuid if any (else `"none"`).

**Check.** If the agent told the user about any failure this turn, a corresponding
`RunFailure` exists. Owned by the user (§1).

---

## §6 Stage (and node) field formats — no blanks, documented limits

Populate **every** field, including optional ones. Stay within these limits.

**`Stage`** (real schema field keys — `details` has an **s**; titleField is
`one_liner`; there is no separate custom `title` field, so the top-level create
`title` mirrors `one_liner`):
| Field | Format / limit | At submit | At completion |
|---|---|---|---|
| `title` (top-level, create only) | ≤ 60 chars; set = `one_liner` value | set | — |
| `one_liner` (titleField) | ≤ 60 chars; `"<env> <model> b<batch>g<group> <cluster>"` e.g. `"erdos qwen3_8b b4g16 civo"` | set | unchanged |
| `details` | ≤ 240 chars; purpose + gate decision + expected `entity/project/name` + job id | set | may append outcome |
| `node_date` | `YYYY-MM-DDT00:00:00` (datetime needs the `T00:00:00`) | submit date | unchanged |
| `result` | ≤ 240 chars; **never blank**. Submit: `"pending — job <name>, tracking train/reward/avg-turn"`. Done: `"avg-turn <final> (iter <n>/<N>); <one-line verdict>"` | placeholder | final |
| `experiment_id` | parent Experiment uuid | set | — |
| `run_ids` | json array of Run uuids (§3) | ≥0, filled asap | complete |
| `command_ids` | json array of SavedCommand uuids (§4) | `[]` | ≥1 |
| `flows_to` | json array of successor Stage uuids | `[]` unless chained | — |
| `pos_x`, `pos_y` | numbers; dagre/default slot if unknown (never blank — use `0`,`0`) | set | — |

**Reserved-key reminders (Omni):** do not use `status`, `created_at`, `title` (as a
custom key) — they are system-reserved. Enum fields reject explicit `null` (omit
instead). `node_date`/`occurred_at` datetimes must include the `T00:00:00`.

---

## §7 Experiment create-vs-update rule

**Rule (owner-approved).**
- If the user **names** an experiment (existing) → **append** a new `Stage` to it.
- If the user names a **new** experiment or **none** → **create** an `Experiment`
  (title from the run, kind `freeform` unless told otherwise, owned by the user)
  and add the stage as its first node.
- Never silently retitle or re-own an existing experiment.

Matching an "existing" experiment: case-insensitive exact title match owned by /
visible to the user. Ambiguous match (>1) → ask the user which one.

**Check.** Exactly one Experiment is the stage's `experiment_id`; if newly created,
its `created_by` is the user (§1).

---

## Compliance checklist (run before declaring a submit done)

- [ ] Stage/Experiment/RunFailure `created_by` == requesting user (§1)
- [ ] Gate computed; `--priority` matches tier; not over 32 (§2)
- [ ] Run linked or expected-path recorded (§3)
- [ ] (on completion) command saved to `Omni-commands`, linked (§4)
- [ ] Any failure this turn → a `RunFailure` written (§5)
- [ ] No blank fields; within limits; datetimes have `T00:00:00` (§6)
- [ ] Correct experiment created/appended (§7)
