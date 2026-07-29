from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Experiment, Node, NodeCommand, NodeEdge, NodeRun, Run, RunSet, SavedCommand
from ..schemas import (
    CommandRef,
    EdgeCreate,
    EdgeOut,
    ExperimentCreate,
    ExperimentOut,
    ExperimentUpdate,
    GraphOut,
    NodeCreate,
    NodeOut,
    NodePosition,
    NodeRunSetIn,
    NodeUpdate,
    RunSummary,
)

router = APIRouter(prefix="/api", tags=["experiments"])


def _commit_label(run: Run) -> str:
    return run.commit[:7] if run.commit else "—"


def _node_out(db: Session, node: Node) -> NodeOut:
    runs = [link.run for link in node.run_links]
    runs.sort(key=lambda r: r.created_at)
    badge = None
    if node.run_set_id:
        rs = db.get(RunSet, node.run_set_id)
        if rs:  # run set may have been deleted → badge silently drops
            badge = rs.short_id
    commands = sorted(
        (link.command for link in node.command_links if link.command is not None),
        key=lambda c: c.name.lower(),
    )
    return NodeOut(
        id=node.id,
        experiment_id=node.experiment_id,
        one_liner=node.one_liner,
        node_date=node.node_date,
        result=node.result,
        created_at=node.created_at,
        runs=[RunSummary.model_validate(r) for r in runs],
        run_count=len(runs),
        environments=sorted({r.environment for r in runs}),
        commits=sorted({_commit_label(r) for r in runs}),
        run_set_badge=badge,
        commands=[CommandRef(id=c.id, name=c.name) for c in commands],
        pos_x=node.pos_x,
        pos_y=node.pos_y,
    )


def _get_node(db: Session, node_id: str) -> Node:
    node = db.get(Node, node_id)
    if not node:
        raise HTTPException(404, "Node not found")
    return node


def _validate_runs(db: Session, run_ids: list[str]) -> None:
    if not run_ids:
        return
    found = set(db.execute(select(Run.id).where(Run.id.in_(run_ids))).scalars())
    missing = [r for r in run_ids if r not in found]
    if missing:
        raise HTTPException(400, f"Unknown run ids: {missing}")


def _validate_commands(db: Session, command_ids: list[str]) -> None:
    if not command_ids:
        return
    found = set(
        db.execute(select(SavedCommand.id).where(SavedCommand.id.in_(command_ids))).scalars()
    )
    missing = [c for c in command_ids if c not in found]
    if missing:
        raise HTTPException(400, f"Unknown command ids: {missing}")


# --- experiments ---------------------------------------------------------

@router.post("/experiments", response_model=ExperimentOut)
def create_experiment(payload: ExperimentCreate, db: Session = Depends(get_db)):
    e = Experiment(**payload.model_dump())
    db.add(e)
    db.commit()
    db.refresh(e)
    return ExperimentOut.model_validate(e, from_attributes=True)


@router.get("/experiments", response_model=list[ExperimentOut])
def list_experiments(db: Session = Depends(get_db)):
    counts = dict(
        db.execute(select(Node.experiment_id, func.count(Node.id)).group_by(Node.experiment_id)).all()
    )
    out = []
    for e in db.execute(select(Experiment).order_by(Experiment.created_at.desc())).scalars():
        eo = ExperimentOut.model_validate(e, from_attributes=True)
        eo.node_count = counts.get(e.id, 0)
        out.append(eo)
    return out


@router.get("/experiments/{experiment_id}/graph", response_model=GraphOut)
def get_graph(experiment_id: str, db: Session = Depends(get_db)):
    e = db.get(Experiment, experiment_id)
    if not e:
        raise HTTPException(404, "Experiment not found")
    nodes = db.execute(select(Node).where(Node.experiment_id == experiment_id)).scalars().all()
    edges = db.execute(select(NodeEdge).where(NodeEdge.experiment_id == experiment_id)).scalars().all()
    eo = ExperimentOut.model_validate(e, from_attributes=True)
    eo.node_count = len(nodes)
    return GraphOut(
        experiment=eo,
        nodes=[_node_out(db, n) for n in nodes],
        edges=[EdgeOut.model_validate(edge) for edge in edges],
    )


@router.patch("/experiments/{experiment_id}", response_model=ExperimentOut)
def update_experiment(experiment_id: str, payload: ExperimentUpdate, db: Session = Depends(get_db)):
    e = db.get(Experiment, experiment_id)
    if not e:
        raise HTTPException(404, "Experiment not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    db.commit()
    db.refresh(e)
    eo = ExperimentOut.model_validate(e, from_attributes=True)
    eo.node_count = len(e.nodes)
    return eo


@router.delete("/experiments/{experiment_id}")
def delete_experiment(experiment_id: str, db: Session = Depends(get_db)):
    e = db.get(Experiment, experiment_id)
    if not e:
        raise HTTPException(404, "Experiment not found")
    db.delete(e)
    db.commit()
    return {"deleted": experiment_id}


# --- nodes ---------------------------------------------------------------

@router.post("/experiments/{experiment_id}/nodes", response_model=NodeOut)
def create_node(experiment_id: str, payload: NodeCreate, db: Session = Depends(get_db)):
    if not db.get(Experiment, experiment_id):
        raise HTTPException(404, "Experiment not found")
    run_ids = payload.run_ids
    run_set_id = None
    if payload.run_set_id:  # explicit run-set selection → populate + badge
        rs = db.get(RunSet, payload.run_set_id)
        if not rs:
            raise HTTPException(404, "Run set not found")
        run_ids = [link.run_id for link in rs.run_links]
        run_set_id = rs.id
    _validate_runs(db, run_ids)
    _validate_commands(db, payload.command_ids)
    node = Node(
        experiment_id=experiment_id,
        one_liner=payload.one_liner,
        node_date=payload.node_date or date.today(),
        result=payload.result,
        run_set_id=run_set_id,
    )
    db.add(node)
    db.flush()
    for run_id in dict.fromkeys(run_ids):  # dedupe, preserve order
        db.add(NodeRun(node_id=node.id, run_id=run_id))
    for command_id in dict.fromkeys(payload.command_ids):
        db.add(NodeCommand(node_id=node.id, command_id=command_id))
    db.commit()
    db.refresh(node)
    return _node_out(db, node)


@router.patch("/nodes/{node_id}", response_model=NodeOut)
def update_node(node_id: str, payload: NodeUpdate, db: Session = Depends(get_db)):
    node = _get_node(db, node_id)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(node, k, v)
    db.commit()
    db.refresh(node)
    return _node_out(db, node)


@router.patch("/nodes/{node_id}/position", response_model=NodeOut)
def set_node_position(node_id: str, payload: NodePosition, db: Session = Depends(get_db)):
    """Persist a node's canvas position so the layout survives reloads."""
    node = _get_node(db, node_id)
    node.pos_x = payload.x
    node.pos_y = payload.y
    db.commit()
    db.refresh(node)
    return _node_out(db, node)


@router.post("/nodes/{node_id}/runs", response_model=NodeOut)
def add_runs(node_id: str, run_ids: list[str], db: Session = Depends(get_db)):
    node = _get_node(db, node_id)
    _validate_runs(db, run_ids)
    existing = {link.run_id for link in node.run_links}
    added = False
    for run_id in dict.fromkeys(run_ids):
        if run_id not in existing:
            db.add(NodeRun(node_id=node.id, run_id=run_id))
            added = True
    if added:
        node.run_set_id = None  # runs changed → drop the badge
    db.commit()
    db.refresh(node)
    return _node_out(db, node)


@router.delete("/nodes/{node_id}/runs/{run_id:path}", response_model=NodeOut)
def remove_run(node_id: str, run_id: str, db: Session = Depends(get_db)):
    node = _get_node(db, node_id)
    link = db.execute(
        select(NodeRun).where(NodeRun.node_id == node_id, NodeRun.run_id == run_id)
    ).scalar_one_or_none()
    if link:
        db.delete(link)
        node.run_set_id = None  # runs changed → drop the badge
        db.commit()
        db.refresh(node)
    return _node_out(db, node)


@router.post("/nodes/{node_id}/run-set", response_model=NodeOut)
def set_node_run_set(node_id: str, payload: NodeRunSetIn, db: Session = Depends(get_db)):
    """Explicitly attach a run set: replace the node's runs with the run set's
    runs and set the badge. This is the only path that sets run_set_id."""
    node = _get_node(db, node_id)
    rs = db.get(RunSet, payload.run_set_id)
    if not rs:
        raise HTTPException(404, "Run set not found")
    for link in list(node.run_links):
        db.delete(link)
    db.flush()
    for run_id in dict.fromkeys(link.run_id for link in rs.run_links):
        db.add(NodeRun(node_id=node.id, run_id=run_id))
    node.run_set_id = rs.id
    db.commit()
    db.refresh(node)
    return _node_out(db, node)


@router.post("/nodes/{node_id}/commands", response_model=NodeOut)
def add_commands(node_id: str, command_ids: list[str], db: Session = Depends(get_db)):
    node = _get_node(db, node_id)
    _validate_commands(db, command_ids)
    existing = {link.command_id for link in node.command_links}
    for command_id in dict.fromkeys(command_ids):
        if command_id not in existing:
            db.add(NodeCommand(node_id=node.id, command_id=command_id))
    db.commit()
    db.refresh(node)
    return _node_out(db, node)


@router.delete("/nodes/{node_id}/commands/{command_id}", response_model=NodeOut)
def remove_command(node_id: str, command_id: str, db: Session = Depends(get_db)):
    node = _get_node(db, node_id)
    link = db.execute(
        select(NodeCommand).where(
            NodeCommand.node_id == node_id, NodeCommand.command_id == command_id
        )
    ).scalar_one_or_none()
    if link:
        db.delete(link)
        db.commit()
        db.refresh(node)
    return _node_out(db, node)


@router.delete("/nodes/{node_id}")
def delete_node(node_id: str, db: Session = Depends(get_db)):
    node = _get_node(db, node_id)
    db.delete(node)
    db.commit()
    return {"deleted": node_id}


# --- edges ---------------------------------------------------------------

@router.post("/experiments/{experiment_id}/edges", response_model=EdgeOut)
def create_edge(experiment_id: str, payload: EdgeCreate, db: Session = Depends(get_db)):
    if payload.source_id == payload.target_id:
        raise HTTPException(400, "An edge cannot connect a node to itself")
    for nid in (payload.source_id, payload.target_id):
        node = db.get(Node, nid)
        if not node or node.experiment_id != experiment_id:
            raise HTTPException(400, f"Node {nid} is not in this experiment")
    edge = NodeEdge(experiment_id=experiment_id, source_id=payload.source_id, target_id=payload.target_id)
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return EdgeOut.model_validate(edge)


@router.delete("/edges/{edge_id}")
def delete_edge(edge_id: str, db: Session = Depends(get_db)):
    edge = db.get(NodeEdge, edge_id)
    if not edge:
        raise HTTPException(404, "Edge not found")
    db.delete(edge)
    db.commit()
    return {"deleted": edge_id}
