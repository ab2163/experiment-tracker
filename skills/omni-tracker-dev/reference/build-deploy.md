# Build & deploy

The page is a single-file Vite bundle built **on top of the omni skill's app
template** (the repo has no build scaffolding of its own) and uploaded to the existing
Omni page.

- **Page id:** `019fbf3d-ec08-7861-812c-9ecef3c27929`
- **URL:** https://curieos.orbitalindustries.com/pages/019fbf3d-ec08-7861-812c-9ecef3c27929
- **Schema linked:** `experiment_tracker_core`

## Rebuild (from `omni/tracker_app/README.md`, current)

```bash
cp -r .claude/skills/omni/templates/app /tmp/tracker-app && cd /tmp/tracker-app
export NODE_OPTIONS="--disable-wasm-trap-handler"          # sandbox WASM OOM otherwise
npm ci --ignore-scripts
npm install --ignore-scripts @tanstack/react-table @xyflow/react @dagrejs/dagre
# overlay the authored files onto the template:
cp -r <repo>/omni/tracker_app/src/* src/            # authored src overrides template src
cp <repo>/omni/tracker_app/omni-page.json .
rm -f src/screens/Dashboard.tsx                     # template sample screen, not used
npm run typecheck && npm run build                  # -> dist/index.html (CSS+JS inlined)
```

### Deps beyond the kit
`@tanstack/react-table` (Runs table), `@xyflow/react` (v12 — the flow graph),
`@dagrejs/dagre` (LR auto-layout). Installed with `--ignore-scripts`. The template
guidance says "don't add deps"; these are the deliberate, documented exceptions (the
flow graph genuinely needs React Flow + a layout lib). `--ignore-scripts` mitigates the
lifecycle-script risk.

### Why the flags
- `NODE_OPTIONS=--disable-wasm-trap-handler` — the build sandbox OOMs on WASM trap
  handling without it.
- `npm ci --ignore-scripts` — install against the template's lockfile without running
  lifecycle scripts.

## Deploy (upload to the page)

```bash
python .claude/skills/omni/scripts/pages_api.py upload \
  --id 019fbf3d-ec08-7861-812c-9ecef3c27929 --path index.html --file ./dist/index.html
# only if the manifest changed:
python .claude/skills/omni/scripts/pages_api.py upload \
  --id 019fbf3d-ec08-7861-812c-9ecef3c27929 --path omni-page.json --file ./omni-page.json
```
Limits: ≤10 MB/file, ≤100 MB/page, 30 req/s. The current bundle is ~0.7 MB (gzip ~180 KB).

## Verify — and the hard limit on verification
- `npm run typecheck` + `npm run build` must be **clean**; report the module/size count
  like the project log does.
- **The bridge only answers inside Omni's iframe.** You cannot exercise
  `omni.query`/`omni.action` from here. So:
  1. validate every new create/update/delete **payload** against the live graph via the
     REST `/mutations` endpoint (graph-schema.md) using a throwaway node you then delete;
  2. rely on typecheck+build for the UI wiring;
  3. state **"NOT iframe-tested"** in your report (this is the norm for this page).

## After deploy
Sync the authored files back to `omni/tracker_app/` in the repo (src/**, omni-page.json,
README) — that dir is the source of record. **Do not** commit `node_modules`, `dist`, or
the template copy. Commit only when the user asks (dev-and-deploy conventions match the
other skills: repo `ab2163`, branch `main`, `git -c safe.directory=…`, co-author trailer).
