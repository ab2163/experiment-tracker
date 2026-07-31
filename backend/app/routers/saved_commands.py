"""Saved commands — named, reusable run commands the user can attach to nodes."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Folder, NodeCommand, SavedCommand
from ..schemas import (
    FolderItemMove,
    SavedCommandCreate,
    SavedCommandOut,
    SavedCommandUpdate,
)

router = APIRouter(prefix="/api/saved-commands", tags=["saved-commands"])


def _get_command(db: Session, command_id: str) -> SavedCommand:
    cmd = db.get(SavedCommand, command_id)
    if not cmd:
        raise HTTPException(404, "Command not found")
    return cmd


def _validate_folder(db: Session, folder_id: Optional[str]) -> None:
    if folder_id is None:
        return
    folder = db.get(Folder, folder_id)
    if not folder or folder.kind != "command":
        raise HTTPException(400, "Target folder is not a valid command folder.")


def _check_unique_name(db: Session, name: str, exclude_id: Optional[str] = None) -> None:
    q = select(SavedCommand.id).where(SavedCommand.name == name)
    if exclude_id:
        q = q.where(SavedCommand.id != exclude_id)
    if db.execute(q).first():
        raise HTTPException(400, f"A command named “{name}” already exists.")


@router.get("", response_model=list[SavedCommandOut])
def list_commands(db: Session = Depends(get_db)):
    cmds = db.execute(select(SavedCommand).order_by(SavedCommand.created_at.desc())).scalars().all()
    return [SavedCommandOut.model_validate(c) for c in cmds]


@router.post("", response_model=SavedCommandOut)
def create_command(payload: SavedCommandCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    command = payload.command.strip()
    if not name:
        raise HTTPException(400, "A command name is required.")
    if not command:
        raise HTTPException(400, "The command text cannot be empty.")
    _check_unique_name(db, name)
    _validate_folder(db, payload.folder_id)
    cmd = SavedCommand(name=name, command=command, folder_id=payload.folder_id)
    db.add(cmd)
    db.commit()
    db.refresh(cmd)
    return SavedCommandOut.model_validate(cmd)


@router.patch("/{command_id}", response_model=SavedCommandOut)
def update_command(command_id: str, payload: SavedCommandUpdate, db: Session = Depends(get_db)):
    cmd = _get_command(db, command_id)
    name = payload.name.strip()
    command = payload.command.strip()
    if not name:
        raise HTTPException(400, "A command name is required.")
    if not command:
        raise HTTPException(400, "The command text cannot be empty.")
    _check_unique_name(db, name, exclude_id=command_id)
    cmd.name = name
    cmd.command = command
    db.commit()
    db.refresh(cmd)
    return SavedCommandOut.model_validate(cmd)


@router.patch("/{command_id}/folder", response_model=SavedCommandOut)
def move_command(command_id: str, payload: FolderItemMove, db: Session = Depends(get_db)):
    cmd = _get_command(db, command_id)
    _validate_folder(db, payload.folder_id)
    cmd.folder_id = payload.folder_id
    db.commit()
    db.refresh(cmd)
    return SavedCommandOut.model_validate(cmd)


@router.delete("/{command_id}")
def delete_command(command_id: str, db: Session = Depends(get_db)):
    cmd = _get_command(db, command_id)
    # Remove node associations explicitly: SQLite doesn't enforce ON DELETE
    # CASCADE by default, so the links would otherwise dangle.
    db.execute(delete(NodeCommand).where(NodeCommand.command_id == command_id))
    db.delete(cmd)
    db.commit()
    return {"deleted": command_id}
