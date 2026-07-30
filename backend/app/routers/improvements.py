"""Improvements — a lightweight ticket list for tracking improvements to make."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Counter, Improvement
from ..schemas import ImprovementCreate, ImprovementOut, ImprovementUpdate

router = APIRouter(prefix="/api/improvements", tags=["improvements"])

TITLE_MAX = 60
_COUNTER_NAME = "improvement"


def _next_number(db: Session) -> int:
    """Hand out the next ticket number and advance the counter. Strictly
    ascending and never reused, even after a ticket is deleted."""
    counter = db.get(Counter, _COUNTER_NAME)
    if counter is None:
        counter = Counter(name=_COUNTER_NAME, value=0)
        db.add(counter)
        db.flush()
    number = counter.value
    counter.value = number + 1
    return number


def _get_improvement(db: Session, improvement_id: str) -> Improvement:
    imp = db.get(Improvement, improvement_id)
    if not imp:
        raise HTTPException(404, "Improvement not found")
    return imp


def _validate_title(title: str) -> str:
    title = title.strip()
    if not title:
        raise HTTPException(400, "A title is required.")
    if len(title) > TITLE_MAX:
        raise HTTPException(400, f"Title must be at most {TITLE_MAX} characters.")
    return title


@router.get("", response_model=list[ImprovementOut])
def list_improvements(db: Session = Depends(get_db)):
    imps = db.execute(select(Improvement).order_by(Improvement.number.desc())).scalars().all()
    return [ImprovementOut.model_validate(i) for i in imps]


@router.post("", response_model=ImprovementOut)
def create_improvement(payload: ImprovementCreate, db: Session = Depends(get_db)):
    title = _validate_title(payload.title)
    imp = Improvement(
        number=_next_number(db),
        title=title,
        description=(payload.description or None),
        priority=payload.priority,
    )
    db.add(imp)
    db.commit()
    db.refresh(imp)
    return ImprovementOut.model_validate(imp)


@router.patch("/{improvement_id}", response_model=ImprovementOut)
def update_improvement(improvement_id: str, payload: ImprovementUpdate, db: Session = Depends(get_db)):
    imp = _get_improvement(db, improvement_id)
    data = payload.model_dump(exclude_unset=True)
    if "title" in data:
        imp.title = _validate_title(data["title"] or "")
    if "description" in data:
        imp.description = data["description"] or None
    if "priority" in data:
        imp.priority = data["priority"]
    db.commit()
    db.refresh(imp)
    return ImprovementOut.model_validate(imp)


@router.delete("/{improvement_id}")
def delete_improvement(improvement_id: str, db: Session = Depends(get_db)):
    imp = _get_improvement(db, improvement_id)
    db.delete(imp)
    db.commit()
    return {"deleted": improvement_id}
