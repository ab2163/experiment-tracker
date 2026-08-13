# The `experiment_tracker_core` graph schema

Everything the app shows is nodes/edges in this schema (subgraph `default`). Reach it
directly with the helper:
```python
import sys; sys.path.insert(0, ".claude/skills/omni")
from omni_api import make_request   # (method, path, params=None, body=None, files=None)
```
Paths are relative to the Omni API root (the helper adds the prefix).

## Node types (9)

| Type | titleField | identity | Key fields |
|---|---|---|---|
| **Run** | display_name | upsert (wandb_id) | wandb_id, project, url, user, state(enum running/finished/crashed), run_created_at, commit, environment, batch_size, group_size, hyperparameters(json) |
| **Experiment** | title | reject | kind(enum linear/pr/freeform), ref_url, description, experiment_created_at, folder_id, visibility, is_template |
| **Stage** | one_liner | reject | node_date(datetime), result, details, experiment_id, flows_to(json), run_ids(json), run_set_ids(json), command_ids(json), pos_x/pos_y(number) |
| **RunSet** | name | reject | short_id(unique), rs_created_at, run_ids(json), folder_id, visibility, is_template |
| **SavedCommand** | name | reject | command, folder_id, visibility, is_template |
| **Folder** | name | reject | kind(enum run_set/command), parent_folder_id, folder_created_at |
| **Improvement** | title | upsert (number) | number(unique), description, priority(enum H/M/L), resolution(enum unresolved/resolved), improvement_created_at |
| **IngestRun** | summary | reject | outcome, error, run_count, projects_scanned, projects_failed, since, failures (WandB-ingest audit log) |
| **RunFailure** | summary | reject | category(enum), job_name, cluster, command, error_excerpt, occurred_at, resolution, stage_id — **used by the `optprime-runs` skill; do not remove** |

## Edge types (2)
`USES_RUN` (Stage→Run) and `RUN_SET_HAS_RUN` (RunSet→Run), both `mergeOnEndpoints`.
The old `HAS_STAGE` / `FLOWS_TO` / `STAGE_USES_COMMAND` edges were **dropped** — those
relationships live as node properties now (see architecture.md / bridge.md). A
`hasStage` source is still declared in `omni-page.json` but returns nothing.

## Function registry
`ingest_wandb_runs` (the cron WandB ingest). PATCHing the schema must preserve it.

## Reserved / special field keys (WILL bite you)
- **`status`** is reserved — Improvement uses **`resolution`**; RunFailure uses
  **`category`**. Never add a `status` property.
- **`created_at`** is a reserved system property — use a custom name
  (`experiment_created_at`, `rs_created_at`, `occurred_at`, …).
- **`title`** as a *custom* field collides with the system title. When a node's
  `titleField` is a custom key (Stage.one_liner, Run.display_name, RunFailure.summary),
  a `create_node` still needs a **top-level `title`** AND the custom key in
  `properties`. When titleField *is* `title` (Experiment, Improvement), pass only the
  top-level `title`.
- **Enum fields reject an explicit `null`** — omit the key instead of sending null
  (see `ops.createExperiment` omitting empty `kind`).
- **`datetime` fields need a full timestamp** — a bare `YYYY-MM-DD` 422s; pad to
  `YYYY-MM-DDT00:00:00` (see `ops.dateToIso`).

## Reading nodes (REST)
```python
# list a type (paged): {items, next_cursor, total_count}
make_request("GET", "/schemas/experiment_tracker_core/subgraphs/default/nodes",
             params={"node_type": "Stage", "limit": 200})
# node detail:
make_request("GET", "/schemas/experiment_tracker_core/subgraphs/default/nodes/{id}")
```
`POST .../query` does **not** exist (404) — use the GET above.

## Mutating nodes (REST — full power, incl. edges/allow_orphan)
```python
make_request("POST", "/schemas/experiment_tracker_core/subgraphs/default/mutations",
  body={"deltas": [
    {"type":"create_node","node_type":"Stage","ref":"s","title":"…","properties":{…}},
    {"type":"update_node","node_id":"…","updates":{"result":"…"}},   # FLAT updates
    {"type":"delete_node","node_id":"…"},
  ]})   # returns {"refs": {"s": "<uuid>"}}
```
Note the shape difference: the **REST** `update_node` uses flat `updates:{…}`; the
**page bridge** `updateNode` action uses nested `properties:{…}` (bridge.md). Creating a
non-rootable node directly needs `"allow_orphan": true` (the bridge has no such escape
hatch — see gotchas.md).

## Editing the schema — PATCH, never PUT
```python
sch = make_request("GET", "/schemas/experiment_tracker_core")
new_types = sch["nodeTypes"] + [ my_new_type ]      # or edit an existing one in place
make_request("PATCH", "/schemas/experiment_tracker_core", body={"nodeTypes": new_types})
```
- **PATCH preserves** `edgeTypes` / `functionRegistry` / `subgraphSchemas`; **PUT wipes
  them** (and PUT also 409s unless you re-send `parentScopeId`). Always PATCH.
- A node type is a dict: `{type, displayName, titleField, subtitleField, states,
  identity, uniqueKeys, fields:[…]}`. `states` must be **`null`** (not `[]` → 422). A
  field is `{key,label,kind,required,unique,uniqueScope,values,…}`; `kind` ∈
  `string|number|datetime|json|enum|url`; enum sets `values:[…]`. Clone an existing
  type's field dict shape rather than hand-rolling (missing keys 422).
- To make a node **rootable** (so the page can `create-node` it), it must not be the
  target of a live edge type; if it is, drop that edge type from **both** `edgeTypes`
  and every `subgraphSchemas[].edgeTypes` (forgetting the subgraph list 422s
  "references unknown edge types").
- After a schema field change, update `data.tsx` (normalize + row type) and the
  relevant `ops.ts` payload + screen so the app reads/writes it.
