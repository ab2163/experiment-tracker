"""Folders — recursive grouping for run sets and saved commands.

One tree per `kind` ("run_set" | "command"). Folder names are unique among
siblings (same kind + parent). Deleting a folder cascades to its subfolders and
to the run sets / commands contained anywhere beneath it.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Folder, NodeCommand, RunSet, SavedCommand
from ..schemas import FolderCreate, FolderMove, FolderOut, FolderRename

router = APIRouter(prefix="/api/folders", tags=["folders"])


def _get_folder(db: Session, folder_id: str) -> Folder:
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(404, "Folder not found")
    return folder


def _sibling_name_taken(
    db: Session, kind: str, parent_id: Optional[str], name: str, exclude_id: Optional[str] = None
) -> bool:
    q = select(Folder.id).where(Folder.kind == kind, Folder.name == name)
    q = q.where(Folder.parent_id.is_(None)) if parent_id is None else q.where(Folder.parent_id == parent_id)
    if exclude_id:
        q = q.where(Folder.id != exclude_id)
    return db.execute(q).first() is not None


def _subtree_ids(db: Session, kind: str, root_id: str) -> list[str]:
    """All folder ids in the subtree rooted at root_id (inclusive)."""
    children: dict[Optional[str], list[str]] = {}
    for fid, pid in db.execute(
        select(Folder.id, Folder.parent_id).where(Folder.kind == kind)
    ).all():
        children.setdefault(pid, []).append(fid)
    ids: list[str] = []
    stack = [root_id]
    while stack:
        cur = stack.pop()
        ids.append(cur)
        stack.extend(children.get(cur, []))
    return ids


def _validate_parent(db: Session, kind: str, parent_id: Optional[str]) -> None:
    if parent_id is None:
        return
    parent = db.get(Folder, parent_id)
    if not parent or parent.kind != kind:
        raise HTTPException(400, "Parent folder is not a valid folder of this kind.")


@router.get("", response_model=list[FolderOut])
def list_folders(kind: str = Query(...), db: Session = Depends(get_db)):
    folders = db.execute(
        select(Folder).where(Folder.kind == kind).order_by(Folder.name)
    ).scalars().all()
    return [FolderOut.model_validate(f) for f in folders]


@router.post("", response_model=FolderOut)
def create_folder(payload: FolderCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "A folder name is required.")
    _validate_parent(db, payload.kind, payload.parent_id)
    if _sibling_name_taken(db, payload.kind, payload.parent_id, name):
        raise HTTPException(400, f"A folder named “{name}” already exists here.")
    folder = Folder(kind=payload.kind, name=name, parent_id=payload.parent_id)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return FolderOut.model_validate(folder)


@router.patch("/{folder_id}", response_model=FolderOut)
def rename_folder(folder_id: str, payload: FolderRename, db: Session = Depends(get_db)):
    folder = _get_folder(db, folder_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "A folder name is required.")
    if _sibling_name_taken(db, folder.kind, folder.parent_id, name, exclude_id=folder.id):
        raise HTTPException(400, f"A folder named “{name}” already exists here.")
    folder.name = name
    db.commit()
    db.refresh(folder)
    return FolderOut.model_validate(folder)


@router.patch("/{folder_id}/move", response_model=FolderOut)
def move_folder(folder_id: str, payload: FolderMove, db: Session = Depends(get_db)):
    folder = _get_folder(db, folder_id)
    new_parent = payload.parent_id
    if new_parent == folder.id:
        raise HTTPException(400, "A folder cannot be moved into itself.")
    _validate_parent(db, folder.kind, new_parent)
    if new_parent is not None and new_parent in _subtree_ids(db, folder.kind, folder.id):
        raise HTTPException(400, "A folder cannot be moved into one of its own subfolders.")
    if _sibling_name_taken(db, folder.kind, new_parent, folder.name, exclude_id=folder.id):
        raise HTTPException(400, f"A folder named “{folder.name}” already exists in the destination.")
    folder.parent_id = new_parent
    db.commit()
    db.refresh(folder)
    return FolderOut.model_validate(folder)


@router.delete("/{folder_id}")
def delete_folder(folder_id: str, db: Session = Depends(get_db)):
    folder = _get_folder(db, folder_id)
    ids = _subtree_ids(db, folder.kind, folder.id)
    if folder.kind == "run_set":
        for rs in db.execute(select(RunSet).where(RunSet.folder_id.in_(ids))).scalars().all():
            db.delete(rs)  # ORM cascade removes the RunSetRun links
    else:
        for cmd in db.execute(select(SavedCommand).where(SavedCommand.folder_id.in_(ids))).scalars().all():
            db.execute(delete(NodeCommand).where(NodeCommand.command_id == cmd.id))
            db.delete(cmd)
    db.execute(delete(Folder).where(Folder.id.in_(ids)))
    db.commit()
    return {"deleted": folder_id, "folders_removed": len(ids)}
