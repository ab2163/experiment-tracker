# Gotchas (Omni tracker)

Traps this page has actually hit. Most stem from the page bridge or the Omni graph, and
do **not** apply to the standalone FastAPI app.

## Modelling
- **No create/reverse edge from the page** → model every relationship as a **property**
  (`flows_to`, `run_ids`, `run_set_ids`, `command_ids`, `folder_id`,
  `parent_folder_id`). This is the single biggest design constraint.
- **`delete_edge` HANGS** in this deployment even via REST (delete_node is fine). Don't
  build flows that need edge deletion; the 124 dormant `STAGE_USES_COMMAND` edges were
  left inert for this reason.
- **create-node needs a rootable type.** A non-rootable type (target of a live edge) is
  rejected `orphan_node`; the bridge has **no `allow_orphan`** (only REST does). Make the
  type rootable by dropping the edge that targets it (from both `edgeTypes` and every
  `subgraphSchemas[].edgeTypes`).

## Schema / graph
- **Reserved keys:** `status` (use `resolution`/`category`), `created_at` (use
  `*_created_at`/`occurred_at`), and `title` as a custom field. See graph-schema.md.
- **Enum fields reject explicit `null`** — omit the key (`ops.createExperiment` omits an
  empty `kind`).
- **datetime fields need `T00:00:00`** — bare `YYYY-MM-DD` 422s (`ops.dateToIso`).
- **PATCH the schema, never PUT** — PUT wipes `edgeTypes`/`functionRegistry` and 409s
  without `parentScopeId`. Preserve the `ingest_wandb_runs` function and the two edge
  types on every PATCH.
- **`states` must be `null`**, not `[]`, in a node-type dict (else 422).
- **Node list is `GET .../nodes?node_type=`** (paged `{items,next_cursor,total_count}`);
  `POST .../query` 404s.
- **`make_request(method, path, params=None, body=None, …)`** — pass mutation payloads
  as **`body=`**; a dict in the 3rd positional slot goes to `params` (URL-encoded) and
  silently no-ops the mutation.
- **REST `update_node` uses flat `updates:{…}`; the bridge `updateNode` action uses
  nested `properties:{…}`.** Don't cross them.
- **`created_by` is server-set** and resolves to the viewer's email (verified
  `ajinkya@orbitalindustries.com`) — the basis for ownership/sharing; don't try to set
  it yourself.
- **Don't remove `RunFailure` or the `Omni-commands` folder** — the `optprime-runs` skill
  writes to them.

## Build / runtime
- **The app isn't standalone** — no `package.json`/vite/tsconfig/`index.html` in the
  repo. Build on the omni app template (build-deploy.md). Missing this is the #1 "how do
  I even build it" confusion.
- **Sandbox WASM OOM** → `export NODE_OPTIONS="--disable-wasm-trap-handler"` before
  building; install with `npm ci --ignore-scripts`.
- **The iframe is sandboxed without `allow-modals`** → `window.confirm/alert/prompt` are
  silently blocked. Use the in-app `src/lib/confirm.tsx` provider, never `window.confirm`.
- **Clipboard:** async `navigator.clipboard` may be blocked in the sandbox — the commands
  copy button falls back to `execCommand`.
- **Bridge only answers inside Omni** → runtime is NOT testable from here; validate
  payloads via REST and report "NOT iframe-tested" (build-deploy.md).

## Data / UI
- **Sources cap at 200/page** → `data.tsx` `drain()` loops `next_cursor`; a custom table
  block is also ~200-row capped (the schema's default grid paginates fully).
- **Runs is the big source** (~4k+ nodes → ~20+ pages) — the one-time drain on mount is
  the main load cost; edits use optimistic `mutate`, not a re-drain.
- **`is_template` artifacts** are split out in `data.tsx` and hidden from normal lists;
  they seed a new viewer via `seed.ts`. Don't let them leak into the normal slices.
- **Sharing (`visibility`) is cosmetic**, not access control — the graph is the real
  boundary.
- **Stale comment:** `manifest.ts` header says "read-only app — no actions"; ignore it,
  actions are declared.

## Two implementations exist
The standalone FastAPI+SQLite+React app (`backend/`+`frontend/`) is a **separate**
codebase sharing only the data *model*. For that one, don't use this skill (and its
constraints here — reserved keys, no-edge, PATCH — do not apply there).
