from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Run
from ..schemas import EnvironmentOut, ProjectOut, RunListOut, RunOut, UserOut

router = APIRouter(prefix="/api", tags=["runs"])


def _apply_filters(
    stmt,
    *,
    environment: Optional[list[str]] = None,
    project: Optional[list[str]] = None,
    user: Optional[list[str]] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
):
    """Apply the shared run filters. Each dimension is a multi-select (IN clause).

    The facet endpoints deliberately omit their *own* dimension so that, e.g.,
    selecting one environment still lists the other environments — while the
    project/user/date facets shrink to only values that co-occur with the
    current selection (options with zero matching runs drop out naturally).
    """
    if environment:
        stmt = stmt.where(Run.environment.in_(environment))
    if project:
        stmt = stmt.where(Run.project.in_(project))
    if user:
        stmt = stmt.where(Run.user.in_(user))
    if date_from:
        stmt = stmt.where(Run.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Run.created_at <= date_to)
    return stmt


@router.get("/environments", response_model=list[EnvironmentOut])
def list_environments(
    db: Session = Depends(get_db),
    project: Optional[list[str]] = Query(None),
    user: Optional[list[str]] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
):
    """Distinct environments with run counts, filtered by the *other* facets."""
    stmt = _apply_filters(
        select(Run.environment, func.count(Run.id)),
        project=project, user=user, date_from=date_from, date_to=date_to,
    ).group_by(Run.environment).order_by(func.count(Run.id).desc())
    rows = db.execute(stmt).all()
    return [EnvironmentOut(environment=env, count=n) for env, n in rows]


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(
    db: Session = Depends(get_db),
    environment: Optional[list[str]] = Query(None),
    user: Optional[list[str]] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
):
    stmt = _apply_filters(
        select(Run.project, func.count(Run.id)),
        environment=environment, user=user, date_from=date_from, date_to=date_to,
    ).group_by(Run.project).order_by(func.count(Run.id).desc())
    rows = db.execute(stmt).all()
    return [ProjectOut(project=p, count=n) for p, n in rows]


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    environment: Optional[list[str]] = Query(None),
    project: Optional[list[str]] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
):
    stmt = _apply_filters(
        select(Run.user, func.count(Run.id)).where(Run.user.is_not(None)),
        environment=environment, project=project, date_from=date_from, date_to=date_to,
    ).group_by(Run.user).order_by(func.count(Run.id).desc())
    rows = db.execute(stmt).all()
    return [UserOut(user=u, count=n) for u, n in rows]


@router.get("/runs", response_model=RunListOut)
def list_runs(
    db: Session = Depends(get_db),
    environment: Optional[list[str]] = Query(None, description="Filter by short env name(s)"),
    project: Optional[list[str]] = Query(None),
    user: Optional[list[str]] = Query(None),
    date_from: Optional[datetime] = Query(None, description="Only runs created on/after this date"),
    date_to: Optional[datetime] = Query(None, description="Only runs created on/before this date"),
    limit: int = Query(200, le=2000),
    offset: int = Query(0, ge=0),
):
    kwargs = dict(
        environment=environment, project=project, user=user,
        date_from=date_from, date_to=date_to,
    )
    total = db.execute(_apply_filters(select(func.count(Run.id)), **kwargs)).scalar_one()
    stmt = (
        _apply_filters(select(Run), **kwargs)
        .order_by(Run.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    runs = db.execute(stmt).scalars().all()
    return RunListOut(total=total, runs=[RunOut.model_validate(r) for r in runs])
