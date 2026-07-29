"""Background ingest: scan all WandB projects for runs and upsert into the DB.

Run standalone:  python -m app.ingest
Threaded across projects because a full sequential scan is ~7 minutes.
"""
from __future__ import annotations

import concurrent.futures as cf
import threading
import time
from typing import Optional, Any

import httpx

from .config import settings
from .db import Base, SessionLocal, engine
from .models import Run
from .wandb_client import WandbClient, _auth_header, normalize_run

_thread_local = threading.local()


def _client() -> WandbClient:
    if not hasattr(_thread_local, "client"):
        http = httpx.Client(timeout=60.0, headers=_auth_header())
        _thread_local.client = WandbClient(http)
    return _thread_local.client


def _scan_project(project: str, since: Any, until: Any = None) -> list[dict]:
    # Ingest every run in the entity (not just OptPrime). normalize_run tolerates
    # missing OptPrime config sections — env/dataset/epoch fields just come back
    # blank/None for non-OptPrime runs.
    return [normalize_run(project, node) for node in _client().iter_runs_since(project, since, until)]


def scan_wandb(since: Any, until: Any = None) -> tuple[list[dict], list[str]]:
    """Threaded scan of every project for OptPrime runs created in [since, until].

    Returns (normalized rows, names of projects that errored). Projects that fail
    are reported rather than silently dropped, so callers can surface a warning.
    """
    Base.metadata.create_all(engine)
    projects = WandbClient().list_projects()

    all_rows: list[dict] = []
    failed: list[str] = []
    with cf.ThreadPoolExecutor(max_workers=settings.ingest_workers) as pool:
        futures = {pool.submit(_scan_project, p, since, until): p for p in projects}
        for fut in cf.as_completed(futures):
            proj = futures[fut]
            try:
                all_rows.extend(fut.result())
            except Exception as exc:  # a single bad project shouldn't abort the scan
                failed.append(proj)
                print(f"  ! project {proj!r} failed: {exc}")
    return all_rows, failed


def ingest(since: Optional[str] = None) -> dict:
    since = since or settings.ingest_since
    t0 = time.time()
    all_rows, failed = scan_wandb(since)

    session = SessionLocal()
    try:
        for row in all_rows:
            session.merge(Run(**row))  # upsert by primary key
        session.commit()
    finally:
        session.close()

    elapsed = time.time() - t0
    result = {"runs": len(all_rows), "failed_projects": len(failed), "seconds": round(elapsed, 1)}
    print(f"Ingested {result['runs']} OptPrime runs in {result['seconds']}s "
          f"(since {since}); {result['failed_projects']} project(s) failed")
    return result


if __name__ == "__main__":
    ingest()
