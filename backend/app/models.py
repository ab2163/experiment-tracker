import random
import string
import uuid
from datetime import date, datetime
from typing import Optional  # PEP 604 (str | None) needs 3.10+; Optional keeps us 3.9-safe

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


_SHORT_ID_ALPHABET = string.ascii_lowercase + string.digits


def gen_short_id() -> str:
    """A 5-char alphanumeric handle (e.g. 'i5fh8'). Callers must ensure uniqueness."""
    return "".join(random.choices(_SHORT_ID_ALPHABET, k=5))


class Run(Base):
    """A single OptPrime run, normalized from WandB. One row per WandB run."""

    __tablename__ = "runs"

    # WandB identity
    id: Mapped[str] = mapped_column(String, primary_key=True)  # entity/project/run_id
    wandb_run_id: Mapped[str] = mapped_column(String, index=True)
    project: Mapped[str] = mapped_column(String, index=True)
    entity: Mapped[str] = mapped_column(String)
    display_name: Mapped[str] = mapped_column(String)
    url: Mapped[str] = mapped_column(String)
    user: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)

    # Versioning inputs
    commit: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)
    env_target: Mapped[str] = mapped_column(String, index=True)  # environments.qspr...QSPRDesign
    environment: Mapped[str] = mapped_column(String, index=True)  # short: qspr

    # Composite version — backfilled by the versioning system (Part 1). Null until then.
    code_version: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)  # V3
    env_version: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # b
    composite_version: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)  # V3b

    # Headline metrics
    batch_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    group_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    epochs_configured: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    epochs_achieved: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Expandable detail: flattened non-hardware hyperparameters {dotted.key: value}
    hyperparameters: Mapped[dict] = mapped_column(JSON, default=dict)

    ingested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Experiments, nodes, graph
# ---------------------------------------------------------------------------

class Experiment(Base):
    """An investigation: a Linear ticket, a PR, or a free-form line of enquiry.
    Owns a graph of Nodes."""

    __tablename__ = "experiments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String, default="freeform")  # linear | pr | freeform
    ref_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    nodes: Mapped[list["Node"]] = relationship(
        back_populates="experiment", cascade="all, delete-orphan"
    )
    edges: Mapped[list["NodeEdge"]] = relationship(
        back_populates="experiment", cascade="all, delete-orphan"
    )


class Node(Base):
    """A themed set of one or more runs within an experiment, plus the user's
    one-liner (intent) and result (retrospective outcome)."""

    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), index=True
    )
    one_liner: Mapped[str] = mapped_column(String)  # what this node is trying to achieve
    node_date: Mapped[date] = mapped_column(Date, default=date.today)
    result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # user-typed outcome
    # The run set the user explicitly attached to this node (for the badge). Set
    # only on explicit selection; cleared whenever the node's runs change. Not a
    # hard FK so a deleted run set simply drops the badge.
    run_set_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Persisted canvas position so the graph layout survives reloads. Null until
    # the node has been placed/dragged; the frontend falls back to auto-layout.
    pos_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pos_y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    experiment: Mapped["Experiment"] = relationship(back_populates="nodes")
    run_links: Mapped[list["NodeRun"]] = relationship(
        back_populates="node", cascade="all, delete-orphan"
    )
    command_links: Mapped[list["NodeCommand"]] = relationship(
        back_populates="node", cascade="all, delete-orphan"
    )


class NodeRun(Base):
    """Association: a run belongs to a node (a run may appear in several nodes)."""

    __tablename__ = "node_runs"
    __table_args__ = (UniqueConstraint("node_id", "run_id", name="uq_node_run"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)

    node: Mapped["Node"] = relationship(back_populates="run_links")
    run: Mapped["Run"] = relationship()


class NodeEdge(Base):
    """Directed edge between two nodes in the same experiment (graph structure)."""

    __tablename__ = "node_edges"
    __table_args__ = (UniqueConstraint("source_id", "target_id", name="uq_edge"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("nodes.id", ondelete="CASCADE"))
    target_id: Mapped[str] = mapped_column(ForeignKey("nodes.id", ondelete="CASCADE"))

    experiment: Mapped["Experiment"] = relationship(back_populates="edges")


# ---------------------------------------------------------------------------
# Run sets — user-curated named lists of runs (independent of the graph).
# ---------------------------------------------------------------------------

class RunSet(Base):
    __tablename__ = "run_sets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String)
    # Short, stable, human-readable handle shown as the node/card badge. Unique
    # across run sets (enforced in the router at create/merge time).
    short_id: Mapped[Optional[str]] = mapped_column(String, unique=True, index=True, nullable=True)
    # Containing folder (null = root). Soft reference managed in the router;
    # deleting a folder deletes its run sets (see routers/folders.py).
    folder_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    run_links: Mapped[list["RunSetRun"]] = relationship(
        back_populates="run_set", cascade="all, delete-orphan"
    )


class RunSetRun(Base):
    __tablename__ = "run_set_runs"
    __table_args__ = (UniqueConstraint("run_set_id", "run_id", name="uq_run_set_run"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    run_set_id: Mapped[str] = mapped_column(ForeignKey("run_sets.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)

    run_set: Mapped["RunSet"] = relationship(back_populates="run_links")
    run: Mapped["Run"] = relationship()


# ---------------------------------------------------------------------------
# Saved commands — named, reusable run commands the user can attach to nodes
# to record how the node's runs are reproduced.
# ---------------------------------------------------------------------------

class SavedCommand(Base):
    __tablename__ = "saved_commands"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    command: Mapped[str] = mapped_column(Text)
    # Containing folder (null = root). Soft reference managed in the router;
    # deleting a folder deletes its commands (see routers/folders.py).
    folder_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class NodeCommand(Base):
    """Association: a saved command is attached to a node (many-to-many)."""

    __tablename__ = "node_commands"
    __table_args__ = (UniqueConstraint("node_id", "command_id", name="uq_node_command"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id", ondelete="CASCADE"), index=True)
    command_id: Mapped[str] = mapped_column(
        ForeignKey("saved_commands.id", ondelete="CASCADE"), index=True
    )

    node: Mapped["Node"] = relationship(back_populates="command_links")
    command: Mapped["SavedCommand"] = relationship()


# ---------------------------------------------------------------------------
# Improvements — a lightweight ticket list for tracking improvements to make.
# ---------------------------------------------------------------------------

class Counter(Base):
    """A named monotonic counter. `value` is the NEXT value to hand out; it only
    ever increases, so numbers are never reused even after a row is deleted."""

    __tablename__ = "counters"

    name: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[int] = mapped_column(Integer, default=0)


class Improvement(Base):
    __tablename__ = "improvements"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    # Auto-assigned, unique, strictly ascending (see Counter). Displayed 4-digit.
    number: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    priority: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # H | M | L
    status: Mapped[str] = mapped_column(String, default="unresolved")  # resolved | unresolved
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Folders — recursive grouping for run sets and saved commands. One tree per
# `kind` ("run_set" | "command"). Names are unique among siblings (same kind +
# parent), enforced in the router. Deleting a folder cascades to its subfolders
# and to the run sets / commands it contains (handled in routers/folders.py).
# ---------------------------------------------------------------------------

class Folder(Base):
    __tablename__ = "folders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String, index=True)  # run_set | command
    name: Mapped[str] = mapped_column(String)
    parent_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
