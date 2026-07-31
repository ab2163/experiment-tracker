from datetime import date, datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str
    project: str
    url: str
    user: Optional[str]
    state: Optional[str]
    created_at: datetime
    commit: Optional[str]
    environment: str
    env_target: str
    composite_version: Optional[str]
    batch_size: Optional[int]
    group_size: Optional[int]
    epochs_configured: Optional[int]
    epochs_achieved: Optional[float]
    hyperparameters: dict[str, Any]


class RunListOut(BaseModel):
    total: int
    runs: list[RunOut]


class EnvironmentOut(BaseModel):
    environment: str
    count: int


class ProjectOut(BaseModel):
    project: str
    count: int


class UserOut(BaseModel):
    user: Optional[str]
    count: int


# --- Experiments / nodes / graph -----------------------------------------

class RunSummary(BaseModel):
    """Compact run info shown inside a node."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str
    url: str
    environment: str
    commit: Optional[str]
    state: Optional[str]
    epochs_achieved: Optional[float]


class ExperimentCreate(BaseModel):
    title: str
    kind: Literal["linear", "pr", "freeform"] = "freeform"
    ref_url: Optional[str] = None
    description: Optional[str] = None


class ExperimentUpdate(BaseModel):
    title: Optional[str] = None
    kind: Optional[Literal["linear", "pr", "freeform"]] = None
    ref_url: Optional[str] = None
    description: Optional[str] = None


class ExperimentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    kind: str
    ref_url: Optional[str]
    description: Optional[str]
    created_at: datetime
    node_count: int = 0


class CommandRef(BaseModel):
    """Compact saved-command info shown inside a node."""

    id: str
    name: str


class NodeCreate(BaseModel):
    one_liner: str
    node_date: Optional[date] = None
    result: Optional[str] = None
    run_ids: list[str] = []
    # Saved commands to attach at creation (how the node's runs are reproduced).
    command_ids: list[str] = []
    # If set, the node is populated from this run set's runs and gets its badge.
    run_set_id: Optional[str] = None


class NodeRunSetIn(BaseModel):
    run_set_id: str


class NodePosition(BaseModel):
    x: float
    y: float


class NodeUpdate(BaseModel):
    one_liner: Optional[str] = None
    node_date: Optional[date] = None
    result: Optional[str] = None


class NodeOut(BaseModel):
    id: str
    experiment_id: str
    one_liner: str
    node_date: date
    result: Optional[str]
    created_at: datetime
    runs: list[RunSummary]
    run_count: int
    environments: list[str]
    commits: list[str]
    run_set_badge: Optional[str] = None
    commands: list[CommandRef] = []
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None


class EdgeCreate(BaseModel):
    source_id: str
    target_id: str


class EdgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    target_id: str


class GraphOut(BaseModel):
    experiment: ExperimentOut
    nodes: list[NodeOut]
    edges: list[EdgeOut]


# --- Data loading / sync (add-only run ingestion) ------------------------

class SyncStatus(BaseModel):
    last_run_created_at: Optional[datetime]
    run_count: int
    sync_enabled: bool  # False when no WANDB_API_KEY (e.g. the seeded demo image)


class WandbSyncIn(BaseModel):
    since: datetime
    until: Optional[datetime] = None


class WandbSyncResult(BaseModel):
    added: int
    updated: int
    skipped: int
    scanned: int
    failed_projects: int


class ImportDbResult(BaseModel):
    added: int
    skipped: int
    source_runs: int


# --- Run sets ------------------------------------------------------------

class RunSetCreate(BaseModel):
    name: str
    run_ids: list[str] = []
    folder_id: Optional[str] = None


class RunSetUpdate(BaseModel):
    name: str


class RunSetMerge(BaseModel):
    name: str
    source_ids: list[str]
    folder_id: Optional[str] = None


class RunSetOut(BaseModel):
    id: str
    name: str
    short_id: Optional[str] = None
    folder_id: Optional[str] = None
    created_at: datetime
    run_count: int
    runs: list[RunSummary]


# --- Saved commands ------------------------------------------------------

class SavedCommandCreate(BaseModel):
    name: str
    command: str
    folder_id: Optional[str] = None


class SavedCommandUpdate(BaseModel):
    name: str
    command: str


class SavedCommandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    command: str
    folder_id: Optional[str] = None
    created_at: datetime


# --- Folders -------------------------------------------------------------

FolderKind = Literal["run_set", "command"]


class FolderCreate(BaseModel):
    kind: FolderKind
    name: str
    parent_id: Optional[str] = None


class FolderRename(BaseModel):
    name: str


class FolderMove(BaseModel):
    parent_id: Optional[str] = None


class FolderItemMove(BaseModel):
    folder_id: Optional[str] = None


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    name: str
    parent_id: Optional[str]
    created_at: datetime


# --- Improvements --------------------------------------------------------

Priority = Literal["H", "M", "L"]


class ImprovementCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: Optional[Priority] = None


class ImprovementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[Priority] = None


class ImprovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    number: int
    title: str
    description: Optional[str]
    priority: Optional[Priority]
    created_at: datetime
