# Architecture — the Omni tracker app

## Where it lives

```
omni/
  tracker_app/
    omni-page.json          # the page manifest: sources + actions + context + identity (THE contract)
    README.md               # page id, tabs, rebuild steps, the stage-as-properties design
    src/
      App.tsx               # tab shell (Runs | Run sets | Experiments | Saved commands | Improvements)
      bridge/manifest.ts    # typed SOURCES + ACTIONS handles (mirror omni-page.json)
      lib/
        data.tsx            # TrackerDataProvider: drains sources → TrackerData context + mutate()
        ops.ts              # EVERY mutation (omni.action + optimistic mutate)
        folders.ts          # childFolders/breadcrumb/descendantIds/moveOptions
        shortId.ts          # genShortId (unique 5-char run-set handle)
        sharing.tsx         # useMe/ownedByMe/sharedByOther + SHARED_FOLDER_NAME (private/public)
        seed.ts             # first-entry seeding of the "Example" (is_template) artifacts
        confirm.tsx, icons.tsx, richtext.tsx
      screens/
        RunsTab, RunSetsTab, ExperimentsTab, CommandsTab, ImprovementsTab,
        FlowGraph (in-app React-Flow stage graph), FolderChrome (breadcrumb/tiles/move)
  ingest_wandb_runs.py, ingest_from_db.py, ingest_graph_from_db.py, import_folders.py
```

## It is NOT standalone — it overlays the omni app template

The repo intentionally does **not** contain `package.json`, `vite.config`, `tsconfig`,
or `index.html`. You build by copying the omni skill's app template
(`.claude/skills/omni/templates/app`) and overlaying the authored `src/**` +
`omni-page.json` onto it. The template provides:

- the **`omni` bridge object** — `omni.query(sourceKey, params)` (read a declared
  source) and `omni.action(actionKey, payload)` (run a declared action);
- kit hooks like **`useOmniUser()`** (viewer identity), `useOmniColorScheme()`;
- **Mantine** + React + the Vite single-file build (`vite-plugin-singlefile`).

So imports like `import { omni } from "../bridge"` and `@shared/omni-ui` resolve to
template-provided modules, not authored files. Build steps: [build-deploy.md](build-deploy.md).

## Data flow

```
experiment_tracker_core graph
   │  omni.query(source, {cursor})  ── drained 200/page in data.tsx ──►
TrackerData (React context)  ──►  screens read via useTracker()
   ▲                                        │  user edits
   └──── mutate((d)=>d)  ◄── ops.ts: await omni.action(...) then optimistic mutate ──┘
```

- **`data.tsx`** runs once on mount: `drain()` loops `omni.query(name, {cursor})`
  following `next_cursor` (sources are capped at 200/page) for runs, experiments,
  stages, runSets, commands, runSetRuns (edges), improvements, folders. It normalizes
  each `RawNode` (`{id, type, title, properties, created_by}`) into typed rows
  (`RunRow`, `StageRow`, …), resolving `created_by`/`createdBy` → `owner`, `visibility`
  (private/public), and splitting off `is_template`-flagged "Example" artifacts into
  `Templates` (hidden from normal lists; used by `seed.ts`). Exposes `useTracker()` and
  `mutate(fn)`.
- **`ops.ts`** is the only writer: each fn does `await omni.action(ACTIONS.x, {...})`
  then `mutate(d => …)` to patch local state (no full re-drain per edit). Study it
  before adding mutations — it already encodes the property-based modelling and the
  reserved-key handling (e.g. `dateToIso` pads datetimes; `kind` omitted when empty).

## The Stage graph is modelled on nodes, not edges

Because the bridge can't create edges, a `Stage` carries its own structure as
properties: `experiment_id` (parent), `flows_to` (successor Stage ids), `run_ids`,
`run_set_ids`, `command_ids`, `pos_x`/`pos_y`. The old `HAS_STAGE`/`FLOWS_TO` edge
types were dropped (also making `Stage` rootable so the page can create one).
`USES_RUN` / `RUN_SET_HAS_RUN` edges remain in the schema (imported data), and
`data.tsx` falls back to counting `RUN_SET_HAS_RUN` when a RunSet has no `run_ids`
property. See [bridge.md](bridge.md) and [graph-schema.md](graph-schema.md).

## Sharing & seeding
`sharing.tsx` + a `visibility` property (`private`/`public`) + the server-set
`created_by` give a cosmetic "Shared …" folder of others' public items (NOT access
control — the graph is the real boundary). `seed.ts` copies the canonical `is_template`
"Example" experiment/run-sets/commands into a new viewer's space on first entry.

## Ingest scripts (`omni/*.py`)
Direct-to-graph importers run via the REST API (not the page): `ingest_wandb_runs.py`
(the cron function-backed WandB ingest), `ingest_from_db.py` (upsert Runs from a
tracker `.db`), `ingest_graph_from_db.py` (experiments/stages/run-sets/commands +
edges), `import_folders.py` (folders + folder_id backfill). They use `omni_api` and the
`/mutations` endpoint — see graph-schema.md. Live WandB ingest is currently blocked by a
secret-value platform bug (Linear CUR-2698).
