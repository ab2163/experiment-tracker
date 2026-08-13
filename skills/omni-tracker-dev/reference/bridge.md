# The page bridge contract

The app talks to the graph only through the **bridge**, governed by `omni-page.json`
(the runtime contract) mirrored by `src/bridge/manifest.ts` (typed handles). The bridge
**rejects any source key or action key not declared** in `omni-page.json`, and any
`schemaId` not in the page's linked schemas.

## Sources (reads) — `omni.query(sourceKey, params)`
Declared in `omni-page.json` as `subgraph-nodes` or `subgraph-edges` over
`experiment_tracker_core` / subgraph `default`, `limit` 200:

| key | query | of |
|---|---|---|
| runs, experiments, stages, runSets, commands, improvements, folders | subgraph-nodes | that node type |
| runSetRuns | subgraph-edges | RUN_SET_HAS_RUN |
| hasStage | subgraph-edges | HAS_STAGE (dead — returns nothing) |

`data.tsx` **drains** each (200/page cap) by looping `omni.query(key, {cursor})` on
`next_cursor`. To add data, add a source here + in `manifest.ts` `SOURCES` + drain it in
`data.tsx`.

## Actions (writes) — `omni.action(actionKey, payload)`
The bridge supports only these action **kinds**: `create-node`,
`create-node-with-parent`, `update-node`, `delete-node`, `upload-file`. Declared
actions:

- **create-node (one per type):** `createRunSet`, `createCommand`, `createFolder`,
  `createExperiment`, `createStage`, `createImprovement` — each pins `node_type` +
  `subgraph_id`.
- **generic:** `updateNode` (update-node), `deleteNode` (delete-node) — node-type-
  agnostic, reused for every type. (`updateImprovement`/`deleteImprovement` also exist
  but the generic ones work for all.)

### THE constraint: no edge actions
There is **no create-edge / reverse-edge action** (and `delete_edge` hangs even via
REST — see gotchas). So every relationship the app manages is a **property on a node**:
`Stage.flows_to`/`run_ids`/`run_set_ids`/`command_ids`, `RunSet.run_ids`, `*.folder_id`,
`Folder.parent_folder_id`. Adding a Stage link = appending to `flows_to`; reversing =
removing from one node's `flows_to` and adding to the other's (see `ops.reverseLink`).
**Any new relationship must be a property, not an edge.**

## Action payload shapes (from `ops.ts` — follow these exactly)
```ts
// create: top-level title + properties (title mirrors the custom titleField value)
await omni.action(ACTIONS.createStage, {
  title: f.one_liner,
  properties: { one_liner: f.one_liner, node_date: dateToIso(f.node_date),
                result: f.result, experiment_id, flows_to: [], run_ids: [] },
})  // returns { id }
// update: node_id + (optional title) + NESTED properties  ← bridge shape
await omni.action(ACTIONS.updateNode, { node_id, title?, properties: { …changed… } })
// delete:
await omni.action(ACTIONS.deleteNode, { node_id })
```
- **Bridge `update-node` nests changed fields under `properties`** — different from the
  REST `/mutations` `update_node`, which uses **flat `updates`** (graph-schema.md).
- `create-node` returns `{ id }`; capture it for the optimistic row.
- Enum fields: omit when empty (don't send `null`); datetimes via `dateToIso`
  (`T00:00:00`).
- **create-node only works on a rootable node type.** A non-rootable type (target of a
  live edge) is rejected `orphan_node`, and the bridge has **no `allow_orphan`** escape
  (only the REST API does). Fix by making the type rootable (graph-schema.md), not by
  hacking the payload.

## Every mutation is optimistic
`ops.ts` pattern: `await omni.action(...)` then `mutate(d => …patch slice…)` so the UI
updates without re-draining all sources. Keep the local patch consistent with what the
action wrote (see any `ops.ts` fn as the template). On failure, the action throws;
existing code lets it propagate (some screens revert).

## Kit hooks (from the template, not authored)
`useOmniUser()` → viewer `{id,email}` (drives ownership/sharing); `useOmniColorScheme()`
→ light/dark. `omni.query`/`omni.action` are the only graph I/O from inside the page.

## Keeping the two mirrors in sync
`omni-page.json` (runtime) and `src/bridge/manifest.ts` (types) must agree. Add a
source/action to **both**. (Note: the comment at the top of `manifest.ts` still says
"read-only app — no actions" — that's stale; actions are declared right below it.)
