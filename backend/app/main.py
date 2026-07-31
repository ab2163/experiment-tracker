import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from .db import Base, engine
from .models import gen_short_id
from .routers import experiments, folders, improvements, run_sets, runs, saved_commands, sync

app = FastAPI(title="Experiment Tracker", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(runs.router)
app.include_router(experiments.router)
app.include_router(sync.router)
app.include_router(run_sets.router)
app.include_router(saved_commands.router)
app.include_router(improvements.router)
app.include_router(folders.router)


def _ensure_columns():
    """Lightweight additive migration for SQLite: add columns introduced after a
    DB was first created. Safe/no-op if they already exist."""
    if not engine.url.get_backend_name().startswith("sqlite"):
        return
    with engine.begin() as conn:
        node_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(nodes)"))}
        if node_cols and "run_set_id" not in node_cols:
            conn.execute(text("ALTER TABLE nodes ADD COLUMN run_set_id VARCHAR"))
        if node_cols and "pos_x" not in node_cols:
            conn.execute(text("ALTER TABLE nodes ADD COLUMN pos_x FLOAT"))
        if node_cols and "pos_y" not in node_cols:
            conn.execute(text("ALTER TABLE nodes ADD COLUMN pos_y FLOAT"))
        rs_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(run_sets)"))}
        if rs_cols and "short_id" not in rs_cols:
            conn.execute(text("ALTER TABLE run_sets ADD COLUMN short_id VARCHAR"))
        if rs_cols:  # backfill any run sets missing a short_id
            used = {r[0] for r in conn.execute(
                text("SELECT short_id FROM run_sets WHERE short_id IS NOT NULL")
            )}
            missing = [r[0] for r in conn.execute(
                text("SELECT id FROM run_sets WHERE short_id IS NULL")
            )]
            for rs_id in missing:
                sid = gen_short_id()
                while sid in used:
                    sid = gen_short_id()
                used.add(sid)
                conn.execute(
                    text("UPDATE run_sets SET short_id = :s WHERE id = :i"),
                    {"s": sid, "i": rs_id},
                )
        if rs_cols and "folder_id" not in rs_cols:
            conn.execute(text("ALTER TABLE run_sets ADD COLUMN folder_id VARCHAR"))
        sc_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(saved_commands)"))}
        if sc_cols and "folder_id" not in sc_cols:
            conn.execute(text("ALTER TABLE saved_commands ADD COLUMN folder_id VARCHAR"))
        imp_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(improvements)"))}
        if imp_cols and "status" not in imp_cols:
            conn.execute(
                text("ALTER TABLE improvements ADD COLUMN status VARCHAR DEFAULT 'unresolved'")
            )
            conn.execute(text("UPDATE improvements SET status='unresolved' WHERE status IS NULL"))


def _drop_legacy_graph_tables():
    """The motivation→experiment rename changed table/column names on the graph
    tables (which create_all cannot alter in place). The graph is disposable
    curation in this pre-prod tool, so a DB carrying the old `nodes.motivation_id`
    schema has its graph tables dropped and recreated fresh (runs/run_sets kept)."""
    if not engine.url.get_backend_name().startswith("sqlite"):
        return
    with engine.begin() as conn:
        tables = {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
        if "nodes" not in tables:
            return
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(nodes)"))}
        if "motivation_id" in cols:  # legacy schema
            for t in ("node_runs", "node_edges", "pending_runs", "node_submissions",
                      "nodes", "motivations", "run_configs"):
                conn.execute(text(f"DROP TABLE IF EXISTS {t}"))


def _migrate_db_filename():
    """One-time rename of the legacy DB file (ablation.db) to the current default
    (experiment_data.db). Only fires for the default sqlite path when the new file
    doesn't exist yet and the old one does — so no data is created or lost."""
    if not engine.url.get_backend_name().startswith("sqlite"):
        return
    path = engine.url.database
    if not path or os.path.basename(path) != "experiment_data.db" or os.path.exists(path):
        return
    legacy = os.path.join(os.path.dirname(path) or ".", "ablation.db")
    if os.path.exists(legacy):
        os.rename(legacy, path)


def _init_db():
    _migrate_db_filename()
    _drop_legacy_graph_tables()
    Base.metadata.create_all(engine)
    _ensure_columns()


# Run at import so the schema is ready regardless of how the app is launched
# (uvicorn startup events don't fire for some test/embedding scenarios).
_init_db()


@app.on_event("startup")
def _startup():
    _init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


# In the packaged (demo) image FastAPI also serves the built React frontend, so
# the whole app is a single container and the API is same-origin (no CORS). This
# is mounted last so it only catches paths the API routers didn't. Skipped in
# local dev, where Vite serves the frontend on :5173 and proxies /api here.
_frontend_dir = os.environ.get("FRONTEND_DIST") or str(
    Path(__file__).resolve().parent.parent / "static"
)
if Path(_frontend_dir).is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")
