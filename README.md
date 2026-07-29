# Experiment Tracker

A lightweight tool for keeping track of the many runs you do during an ML
experiment. It mirrors your Weights & Biases runs into a local database, lets
you organise them into **run sets**, and lets you map an **experiment** as a
graph of stages (nodes) — each stage holding the runs used and the outcome you
recorded — so you can see what you tried and what you did next.

> Status: early work-in-progress / prototype.

## Why

Experiments are rarely clear-cut — you do repeats, eliminate confounders, add
environments, switch to more stable hyperparameters. Before long you've done
dozens of runs, and remembering what each one was for is hard. Scrolling
through long run lists in the WandB UI is slow. This tool gives you a fast local
view of your runs and a way to record the *story* of an experiment.

## Features

- **Runs** — all your WandB runs pulled into a local DB and shown as a fast,
  sortable, filterable table (multi-select filters for environment / project /
  user, plus a date range; filters cross-reduce each other's options).
- **Run sets** — curate named groups of runs; merge sets into new ones.
- **Experiments** — build a graph of stages. Each **node** holds the runs used
  at that stage (added individually or from a run set) and a free-text result.
  Connect nodes with directional links to map arbitrarily complex flows. Jump
  back to any run via its WandB link.

## Architecture

```
WandB (source of truth)
   │  background ingest (full scan; add-only merge into the DB)
   ▼
SQLite / Postgres  ──►  FastAPI  ──►  React + TanStack Table + React Flow
```

Runs are served from the local DB, not queried from WandB per request. The
FastAPI app can also serve the built frontend as a single app; in local dev,
Vite serves the frontend and proxies `/api`.

## Quick start (development)

### Backend

Quickest — the startup script sets up the venv, installs deps, ingests on first
run, and serves on port 8123:

```bash
cd backend
cp .env.example .env          # then edit .env: set WANDB_API_KEY and WANDB_ENTITY
./run.sh                      # --ingest to force a re-pull, --no-ingest to skip
```

Or do it manually:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Python 3.9+
pip install -r requirements.txt
cp .env.example .env          # then edit .env: set WANDB_API_KEY and WANDB_ENTITY

# 1. Populate the local DB from WandB (scans your entity's projects)
python -m app.ingest

# 2. Serve the API
uvicorn app.main:app --port 8123
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api -> http://localhost:8123)
npm run build      # typecheck + production build into dist/
```

## Configuration

All via environment variables (or a `.env` file in `backend/`, see
`backend/.env.example`):

| Variable | Purpose |
|---|---|
| `WANDB_API_KEY` | Your WandB API key (required to ingest). |
| `WANDB_ENTITY` | Your WandB team/entity to scan. |
| `DATABASE_URL` | `sqlite:///./ablation.db` (default) or a Postgres URL. |
| `INGEST_SINCE` | ISO8601 cutoff; runs created before this are ignored. |
| `INGEST_WORKERS` | Parallel project scanners during ingest. |

When `WANDB_API_KEY` is unset, live-sync is disabled in the UI (read-only mode)
— handy for sharing a snapshot DB as a demo.

## Key API endpoints

- `GET /api/runs` — filterable run list (multi-value `environment`/`project`/`user`, `date_from`, `date_to`)
- `GET /api/environments` · `GET /api/projects` · `GET /api/users` — facet counts (cross-filtered)
- `GET/POST /api/run-sets`, `POST /api/run-sets/merge`
- `GET/POST /api/experiments`, `GET /api/experiments/{id}/graph`
- `POST /api/experiments/{id}/nodes`, `PATCH /api/nodes/{id}`, `POST /api/nodes/{id}/runs`, `POST /api/experiments/{id}/edges`
- `POST /api/sync/wandb`, `POST /api/sync/import-db`, `GET /api/sync/status`
- `GET /health`

## Notes

- The database file (`*.db`) and `.env` are gitignored — no run data or secrets
  are committed. Populate your own DB with `python -m app.ingest`.
- Requires Python 3.9+.
