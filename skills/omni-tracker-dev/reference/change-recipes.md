# Change recipes

Copy-paste-shaped steps. Paths under `omni/tracker_app/`. After any recipe:
`npm run typecheck && npm run build`, validate write payloads against the live graph via
REST `/mutations` (the iframe can't be tested here), then upload (build-deploy.md).

## Recipe A — add a field to an existing node type & surface it

Example: add `notes` to `Experiment`.
1. **Schema** — PATCH `experiment_tracker_core` adding a `notes` string field to the
   Experiment node type (graph-schema.md; clone an existing field dict; PATCH not PUT).
2. **Normalize** — `src/lib/data.tsx`: add `notes` to `ExperimentRow` and read it in the
   Experiment normalization (`notes: s(p.notes)`).
3. **Write** — `src/lib/ops.ts`: include `notes` in `createExperiment`/`updateExperiment`
   `properties` and in the optimistic row `mutate`.
4. **UI** — `src/screens/ExperimentsTab.tsx`: render/edit it.
5. typecheck+build; validate the create/update payload via `/mutations`; upload.

## Recipe B — add a CRUD action for a type that lacks one

The generic `updateNode`/`deleteNode` already cover edits/deletes for every type;
you mostly only add **create** actions.
1. **Manifest** — add the action to `omni-page.json` `actions` (`kind:"create-node"`,
   `node_type`, `subgraph_id:"default"`) **and** to `src/bridge/manifest.ts` `ACTIONS`.
2. **ops.ts** — add a fn: `await omni.action(ACTIONS.x, {title, properties:{…}})` then
   `mutate(...)` to insert the optimistic row (copy an existing create fn).
3. Wire a button/modal in the screen. Ensure the node type is **rootable** (bridge.md).
4. typecheck+build; validate payload via `/mutations`; upload (omni-page.json changed →
   upload it too).

## Recipe C — add a relationship (NOT an edge)

The bridge can't make edges. Model it as an **id-array property** on the owning node
(like `Stage.run_set_ids`).
1. Schema: add a `json` field (default `[]`) to the owner type (PATCH).
2. data.tsx: normalize it to an array on the row.
3. ops.ts: attach/detach = read current array, add/remove id, `omni.action(updateNode,
   {node_id, properties:{<key>: nextArray}})`, then `mutate`. Copy
   `setStageIds`/`attachRunSetToStage`.
4. UI: render the linked items (resolve ids against the relevant slice of `TrackerData`).

## Recipe D — add a whole tab

1. Schema/source/actions as needed (Recipes A/B) if it shows a new type.
2. **data.tsx** — add a `drain(SOURCES.x)` for any new source, a `RowType`, and put the
   normalized slice on `TrackerData` + `mutate` helpers.
3. **screen** — `src/screens/XTab.tsx` reading `useTracker()`.
4. **App.tsx** — extend the tab set and render `XTab` (mirror the existing tabs; the
   Mantine `Tabs`/shell pattern is already there).
5. typecheck+build; upload.

## Recipe E — add a new node type

1. Schema PATCH: append the node type (graph-schema.md — `states:null`, clone field
   shapes, choose `identity`, make it rootable if the page will create it).
2. Source in `omni-page.json` + `manifest.ts`; drain + normalize in `data.tsx`.
3. create/update/delete actions (Recipe B) + `ops.ts` fns.
4. screen + `App.tsx` tab (Recipe D).
5. If seeding "Example" copies applies, extend `seed.ts`/`Templates` in `data.tsx`.

## Recipe F — fix behaviour in a screen / the flow graph
Read the screen + `ops.ts` + `data.tsx` first. Graph edits flow through `ops` link fns
(`addLink`/`deleteLink`/`reverseLink` — all edit `flows_to`) and `savePosition`
(`pos_x`/`pos_y`). Preserve the property-modelling and optimistic `mutate` invariants.
