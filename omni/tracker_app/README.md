# Experiment Tracker — Omni app-Page (tabbed reproduction)

Single tabbed React app-Page reproducing the standalone tracker's tabs over the
experiment_tracker_core graph. Page id 019fbf3d-ec08-7861-812c-9ecef3c27929:
https://curieos.orbitalindustries.com/pages/019fbf3d-ec08-7861-812c-9ecef3c27929

Tabs: **Runs** (TanStack table — cross-filters env/project/user + date, sort,
column-visibility, expandable hyperparameters, 100/page pager, create-run-set from
selection), **Run sets** (cards + short_id badge + expandable run list + merge),
**Experiments** (cards + kind badge + stage count + in-app flow graph),
**Saved commands** (code box + copy), **Improvements** (ticket list).

All tabs have **full CRUD** and **recursive folders** (run sets / commands /
experiments). Each experiment/run-set/command has a **private/public** toggle:
public items appear in other users' read-only "Shared …" folder (ownership via the
server-set `created_by`; identity via the manifest `identity` contract — a
UX affordance, **not** access control). On first entry a new viewer is auto-seeded
with copies of the `is_template`-flagged "Example" artifacts (see `src/lib/seed.ts`).

## Experiment flow graph (in-app)
Clicking an experiment's title (or its "N stages →" link) in the Experiments tab
swaps that tab's content for a React Flow graph of just that experiment's Stages
(dagre LR layout), with a "← Back to experiments" button. Data comes from the
shared TrackerDataProvider, so no extra fetch. This replaces the former
standalone flow pages.

Full CRUD: "+ Add stage" / edit / delete stage; drag between nodes to create a
link; select a link to reverse or delete it.

### Stage structure is modelled on the node, not with edges
The page bridge can create/update/delete *nodes* but cannot create or reverse
*edges*. So a Stage carries its own graph structure as properties:
`experiment_id` (parent), `flows_to` (json array of successor Stage ids) and
`run_ids` (json array, for the run count). The old HAS_STAGE / FLOWS_TO edge
types were dropped from the schema (which also makes Stage rootable so the page
can create one). USES_RUN / RUN_SET_HAS_RUN remain. If you re-import graph data
from a tracker .db, populate these Stage properties rather than edges.

## Deps beyond the kit
@tanstack/react-table, @xyflow/react, @dagrejs/dagre (installed with
`npm install --ignore-scripts`).

## Rebuild
    cp -r .claude/skills/omni/templates/app /tmp/tracker-app && cd /tmp/tracker-app
    export NODE_OPTIONS="--disable-wasm-trap-handler"
    npm ci --ignore-scripts && npm install --ignore-scripts @tanstack/react-table @xyflow/react @dagrejs/dagre
    # overlay authored files from this dir (omni-page.json, src/**), rm src/screens/Dashboard.tsx
    npm run typecheck && npm run build
    python .claude/skills/omni/scripts/pages_api.py upload --id 019fbf3d-ec08-7861-812c-9ecef3c27929 --path index.html --file ./dist/index.html
    python .claude/skills/omni/scripts/pages_api.py upload --id 019fbf3d-ec08-7861-812c-9ecef3c27929 --path omni-page.json --file ./omni-page.json
