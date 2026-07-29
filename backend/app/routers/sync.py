"""Data-loading endpoints — all strictly ADD-ONLY.

Three ways to grow the local `runs` table without ever overwriting a run that is
already stored (matched by primary key `entity/project/run_id`):
  * POST /api/sync/wandb      — pull WandB runs created in a [since, until] window
  * POST /api/sync/import-db  — merge the `runs` table from an uploaded ablation.db
  * GET  /api/sync/status     — latest stored run timestamp + total count

The "sync to now" button in the UI is just POST /wandb with since = the latest
stored run's timestamp and no upper bound.
"""
from __future__ import annotations
from typing import Optional

import json
import os
import sqlite3
import tempfile
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..ingest import scan_wandb
from ..models import Run
from ..schemas import ImportDbResult, SyncStatus, WandbSyncIn, WandbSyncResult

router = APIRouter(prefix="/api/sync", tags=["sync"])

_CHUNK = 500  # keep IN (...) below SQLite's parameter limit
_DT_COLS = {"created_at", "ingested_at"}
_IN_PROGRESS = {"running", "pending", "preempting", "preempted"}


def _existing_states(db: Session, ids: list[str]) -> dict[str, Optional[str]]:
    out: dict[str, Optional[str]] = {}
    for i in range(0, len(ids), _CHUNK):
        chunk = ids[i : i + _CHUNK]
        for rid, state in db.execute(
            select(Run.id, Run.state).where(Run.id.in_(chunk))
        ).all():
            out[rid] = state
    return out


def _add_only(db: Session, rows: list[dict]) -> tuple[int, int]:
    """Insert only rows whose id isn't already stored. Returns (added, skipped)."""
    if not rows:
        return 0, 0
    existing = _existing_states(db, [r["id"] for r in rows])
    added = 0
    seen: set[str] = set()
    for r in rows:
        rid = r["id"]
        if rid in existing or rid in seen:  # skip stored + in-batch duplicates
            continue
        seen.add(rid)
        db.add(Run(**r))
        added += 1
    db.commit()
    return added, len(rows) - added


def _merge_wandb(db: Session, rows: list[dict]) -> tuple[int, int, int]:
    """Add new runs and REFRESH existing runs that were in progress (so a finished
    run loses its running state and gains final metrics). Finished/failed runs are
    left untouched. Returns (added, updated, skipped)."""
    if not rows:
        return 0, 0, 0
    existing = _existing_states(db, [r["id"] for r in rows])
    added = updated = skipped = 0
    seen: set[str] = set()
    for r in rows:
        rid = r["id"]
        if rid in seen:
            continue
        seen.add(rid)
        if rid not in existing:
            db.add(Run(**r))
            added += 1
        elif (existing[rid] or "").lower() in _IN_PROGRESS:
            db.merge(Run(**r))  # refresh the previously-in-progress run
            updated += 1
        else:
            skipped += 1
    db.commit()
    return added, updated, skipped


@router.get("/status", response_model=SyncStatus)
def sync_status(db: Session = Depends(get_db)):
    last = db.execute(select(func.max(Run.created_at))).scalar_one()
    count = db.execute(select(func.count(Run.id))).scalar_one()
    return SyncStatus(
        last_run_created_at=last,
        run_count=count,
        sync_enabled=bool(settings.wandb_api_key),
    )


@router.post("/wandb", response_model=WandbSyncResult)
def sync_wandb(payload: WandbSyncIn, db: Session = Depends(get_db)):
    """Add-only pull of WandB runs created in [since, until] (until=None → now)."""
    if not settings.wandb_api_key:
        raise HTTPException(400, "WANDB_API_KEY is not set in the backend environment.")
    if payload.until and payload.until < payload.since:
        raise HTTPException(400, "`until` must be on or after `since`.")
    rows, failed = scan_wandb(payload.since, payload.until)
    added, updated, skipped = _merge_wandb(db, rows)
    return WandbSyncResult(
        added=added, updated=updated, skipped=skipped,
        scanned=len(rows), failed_projects=len(failed),
    )


def _coerce_run_row(row: dict, cols: set[str]) -> dict:
    """Map a raw sqlite row from an uploaded runs table onto Run's columns."""
    out: dict = {}
    for k, v in row.items():
        if k not in cols:
            continue
        if k in _DT_COLS and isinstance(v, str) and v:
            out[k] = datetime.fromisoformat(v.replace("Z", "").replace(" ", "T"))
        elif k == "hyperparameters" and isinstance(v, str):
            try:
                out[k] = json.loads(v)
            except json.JSONDecodeError:
                out[k] = {}
        else:
            out[k] = v
    return out


@router.post("/import-db", response_model=ImportDbResult)
async def import_db(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Add-only merge of the `runs` table from an uploaded ablation.db (SQLite)."""
    data = await file.read()
    if not data:
        raise HTTPException(400, "Uploaded file is empty.")

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        con = sqlite3.connect(path)
        con.row_factory = sqlite3.Row
        try:
            tables = {
                r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            if "runs" not in tables:
                raise HTTPException(400, "Uploaded file has no 'runs' table — not an ablation.db.")
            cols = {c.name for c in Run.__table__.columns}
            src_rows = [dict(r) for r in con.execute("SELECT * FROM runs")]
        finally:
            con.close()
    except sqlite3.DatabaseError:
        raise HTTPException(400, "Uploaded file is not a valid SQLite database.")
    finally:
        os.unlink(path)

    rows = [_coerce_run_row(r, cols) for r in src_rows]
    added, skipped = _add_only(db, rows)
    return ImportDbResult(added=added, skipped=skipped, source_runs=len(src_rows))
