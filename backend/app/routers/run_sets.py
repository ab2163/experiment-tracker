"""Run sets — user-curated named lists of runs, independent of the graph."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Run, RunSet, RunSetRun, gen_short_id
from ..schemas import RunSetCreate, RunSetMerge, RunSetOut, RunSetUpdate, RunSummary

router = APIRouter(prefix="/api/run-sets", tags=["run-sets"])


def _unique_short_id(db: Session) -> str:
    used = set(db.execute(select(RunSet.short_id)).scalars())
    sid = gen_short_id()
    while sid in used:
        sid = gen_short_id()
    return sid


def _run_set_out(run_set: RunSet) -> RunSetOut:
    runs = [link.run for link in run_set.run_links]
    runs.sort(key=lambda r: r.created_at, reverse=True)
    return RunSetOut(
        id=run_set.id,
        name=run_set.name,
        short_id=run_set.short_id,
        created_at=run_set.created_at,
        run_count=len(runs),
        runs=[RunSummary.model_validate(r) for r in runs],
    )


def _get_run_set(db: Session, run_set_id: str) -> RunSet:
    run_set = db.get(RunSet, run_set_id)
    if not run_set:
        raise HTTPException(404, "Run set not found")
    return run_set


def _validate_runs(db: Session, run_ids: list[str]) -> None:
    if not run_ids:
        return
    found = set(db.execute(select(Run.id).where(Run.id.in_(run_ids))).scalars())
    missing = [r for r in run_ids if r not in found]
    if missing:
        raise HTTPException(400, f"Unknown run ids: {missing}")


@router.get("", response_model=list[RunSetOut])
def list_run_sets(db: Session = Depends(get_db)):
    run_sets = db.execute(select(RunSet).order_by(RunSet.created_at.desc())).scalars().all()
    return [_run_set_out(rs) for rs in run_sets]


@router.post("", response_model=RunSetOut)
def create_run_set(payload: RunSetCreate, db: Session = Depends(get_db)):
    if not payload.name.strip():
        raise HTTPException(400, "A run set name is required.")
    _validate_runs(db, payload.run_ids)
    run_set = RunSet(name=payload.name.strip(), short_id=_unique_short_id(db))
    db.add(run_set)
    db.flush()
    for run_id in dict.fromkeys(payload.run_ids):
        db.add(RunSetRun(run_set_id=run_set.id, run_id=run_id))
    db.commit()
    db.refresh(run_set)
    return _run_set_out(run_set)


@router.post("/merge", response_model=RunSetOut)
def merge_run_sets(payload: RunSetMerge, db: Session = Depends(get_db)):
    """Create a NEW run set containing the union of the source sets' runs. This
    is a copy: the sources are untouched and deleting them later does not affect
    the merged set."""
    if not payload.name.strip():
        raise HTTPException(400, "A run set name is required.")
    if len(payload.source_ids) < 2:
        raise HTTPException(400, "Select at least two run sets to merge.")
    run_ids: list[str] = []
    for sid in payload.source_ids:
        src = db.get(RunSet, sid)
        if not src:
            raise HTTPException(404, f"Run set not found: {sid}")
        run_ids.extend(link.run_id for link in src.run_links)
    merged = RunSet(name=payload.name.strip(), short_id=_unique_short_id(db))
    db.add(merged)
    db.flush()
    for run_id in dict.fromkeys(run_ids):  # union, deduped, order-preserving
        db.add(RunSetRun(run_set_id=merged.id, run_id=run_id))
    db.commit()
    db.refresh(merged)
    return _run_set_out(merged)


@router.patch("/{run_set_id}", response_model=RunSetOut)
def rename_run_set(run_set_id: str, payload: RunSetUpdate, db: Session = Depends(get_db)):
    run_set = _get_run_set(db, run_set_id)
    if not payload.name.strip():
        raise HTTPException(400, "A run set name is required.")
    run_set.name = payload.name.strip()
    db.commit()
    db.refresh(run_set)
    return _run_set_out(run_set)


@router.delete("/{run_set_id}")
def delete_run_set(run_set_id: str, db: Session = Depends(get_db)):
    run_set = _get_run_set(db, run_set_id)
    db.delete(run_set)
    db.commit()
    return {"deleted": run_set_id}


@router.post("/{run_set_id}/runs", response_model=RunSetOut)
def add_runs(run_set_id: str, run_ids: list[str], db: Session = Depends(get_db)):
    run_set = _get_run_set(db, run_set_id)
    _validate_runs(db, run_ids)
    existing = {link.run_id for link in run_set.run_links}
    for run_id in dict.fromkeys(run_ids):
        if run_id not in existing:
            db.add(RunSetRun(run_set_id=run_set.id, run_id=run_id))
    db.commit()
    db.refresh(run_set)
    return _run_set_out(run_set)


@router.delete("/{run_set_id}/runs/{run_id:path}", response_model=RunSetOut)
def remove_run(run_set_id: str, run_id: str, db: Session = Depends(get_db)):
    run_set = _get_run_set(db, run_set_id)
    link = db.execute(
        select(RunSetRun).where(RunSetRun.run_set_id == run_set_id, RunSetRun.run_id == run_id)
    ).scalar_one_or_none()
    if link:
        db.delete(link)
        db.commit()
        db.refresh(run_set)
    return _run_set_out(run_set)
