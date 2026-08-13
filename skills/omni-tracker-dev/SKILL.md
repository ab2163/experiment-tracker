---
name: omni-tracker-dev
description: >-
  Maintain and extend the Omni reproduction of the Experiment Tracker — the tabbed
  React app-Page bound to the `experiment_tracker_core` Omni graph (source under
  omni/tracker_app/ in github.com/ab2163/experiment-tracker), plus the graph schema
  and the ingest scripts. Use whenever asked to change that Omni page/app: add or
  edit a tab, field, node type, CRUD action, or manifest source; fix a bug; edit the
  schema; re-ingest; or rebuild and redeploy the page. Holds the app architecture,
  the graph schema, the page-bridge contract and its constraints, change recipes,
  the build/deploy steps, and the accumulated gotchas — so you don't re-explore the
  code or re-derive the Omni API each time. (For the SEPARATE standalone FastAPI+React
  app under backend/+frontend/, this skill is not the right one.)
---

# Omni Experiment Tracker — maintenance

Standing orientation for working on the **Omni** tracker so an agent can go straight
to a correct change instead of re-reading the app and re-deriving the Omni API.

**What it is:** a single tabbed React app-Page, hosted **inside Omni** (sandboxed
iframe), that reproduces the standalone tracker's tabs over the
`experiment_tracker_core` graph. Page id **`019fbf3d-ec08-7861-812c-9ecef3c27929`**
→ https://curieos.orbitalindustries.com/pages/019fbf3d-ec08-7861-812c-9ecef3c27929 .
Tabs: **Runs, Run sets, Experiments** (with an in-app React-Flow stage graph),
**Saved commands, Improvements** — all with full CRUD, recursive folders, and a
private/public sharing toggle.

> This is a **different codebase and stack** from the standalone app in `backend/` +
> `frontend/`. They share a data *model*, not code. If the request is about the
> FastAPI/SQLite/plain-React app, this skill is the wrong one.

## Orient in 30 seconds

- **Source:** `omni/tracker_app/` — `src/**`, `bridge/manifest.ts`, `omni-page.json`,
  `README.md`. **Vite + React + Mantine**, built as a single-file page.
- **Not standalone:** the authored `src/**` **overlays the omni skill's app template**
  (`.claude/skills/omni/templates/app`), which supplies the bridge runtime — the
  `omni` object (`omni.query` / `omni.action`), `useOmniUser`, Mantine, the build. The
  repo does **not** carry `package.json`/vite/tsconfig/`index.html`; you rebuild on top
  of the template (see build-deploy.md).
- **Data:** everything is the `experiment_tracker_core` graph. `src/lib/data.tsx`
  drains the manifest sources once into a `TrackerData` context; `src/lib/ops.ts` does
  every mutation via `omni.action` + an optimistic local `mutate(...)`.
- **Graph is reached two ways:** the **page bridge** (from inside the app, limited
  actions) and the **REST API** (from an agent, full power — `omni_api.make_request`,
  used for schema edits and ingest). Know which you're using.

## The one constraint that shapes everything

**The page bridge can create/update/delete _nodes_ but cannot create or reverse
_edges_.** So all relationships the app manages are modelled as **properties on
nodes**, never edges: `Stage.flows_to` / `run_ids` / `run_set_ids` / `command_ids`,
`RunSet.run_ids`, `*.folder_id`, `Folder.parent_folder_id`. Any new relationship you
add must follow this — see [reference/bridge.md](reference/bridge.md).

## The change loop

1. **Locate the layer** (schema? app data model? a screen? an action?).
2. **Schema change?** PATCH `experiment_tracker_core` via `omni_api` (never PUT) —
   [reference/graph-schema.md](reference/graph-schema.md).
3. **App change** — vertical slice: manifest (source/action) → `data.tsx` (normalize +
   row type) → `ops.ts` (action + `mutate`) → the screen — see
   [reference/change-recipes.md](reference/change-recipes.md).
4. **Verify:** `npm run typecheck && npm run build` on the template overlay.
5. **Deploy:** upload `dist/index.html` (+ `omni-page.json` if it changed) via
   `pages_api.py` — [reference/build-deploy.md](reference/build-deploy.md).

## Verify & the untestable bit
`typecheck` + `build` must be clean. **The page bridge only answers inside Omni's
iframe**, so runtime behaviour is NOT testable from here — validate action/mutation
payloads against the live graph via `omni_api` `/mutations` first, then rely on
typecheck+build for the UI. Say so in your report ("NOT iframe-tested").

## Reference index

| File | Read it for… |
|---|---|
| [reference/architecture.md](reference/architecture.md) | app structure, the template overlay, data.tsx/ops.ts, screens, sharing/seed, ingest scripts |
| [reference/graph-schema.md](reference/graph-schema.md) | the `experiment_tracker_core` node/edge types, fields, identity, reserved keys, and editing the schema (PATCH) |
| [reference/bridge.md](reference/bridge.md) | the manifest contract (sources/actions), the kit API, the no-edge rule, action payload shapes |
| [reference/change-recipes.md](reference/change-recipes.md) | recipes: add a field, a tab, a CRUD action, a source, a node type |
| [reference/build-deploy.md](reference/build-deploy.md) | rebuild on the template, deps-beyond-kit, upload to the page, caveats |
| [reference/gotchas.md](reference/gotchas.md) | reserved keys, enum-null, datetime, no-edge/hang, PATCH-vs-PUT, sandbox/iframe, drain caps, API quirks |

## House rules
- **Relationships = properties, never edges** (bridge can't make edges).
- **Schema edits are PATCH, never PUT** (PUT wipes edges/functions).
- **Reserved property keys:** don't use `status`, `created_at`, or `title` as a custom
  field; enum fields reject explicit `null` (omit); datetimes need `T00:00:00`.
- Don't remove the `RunFailure` node type or the `Omni-commands` folder — the
  `optprime-runs` skill depends on them.
- Match the surrounding code; keep optimistic `mutate` updates in step with the action.
