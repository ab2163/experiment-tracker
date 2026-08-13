#!/usr/bin/env python3
"""Executable implementation of the graph-side PROTOCOLS for experiment_tracker_core.

Import from an assisted session so that nodes are owned by the requesting user
(created_by is set server-side — verified to resolve to the user's email, §1):

    import sys; sys.path.insert(0, '.claude/skills/omni')
    from graph import (omni_commands_folder, upsert_experiment, create_stage,
                       find_run, link_run, save_command, attach_command, record_failure)

All limits/formats follow PROTOCOLS.md §6 (no field left blank). Endpoints are the
verified ones: GET .../nodes?node_type=, GET .../nodes/{id}, POST .../mutations.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", ".claude", "skills", "omni"))
sys.path.insert(0, ".claude/skills/omni")
from omni_api import make_request  # noqa: E402

SUB = "/schemas/experiment_tracker_core/subgraphs/default"
OMNI_COMMANDS_UUID = "019ffc36-a2b1-79a2-aa41-e5ca02a8e583"


def _clip(s, n):
    s = "" if s is None else str(s)
    return s[:n]


def list_nodes(node_type):
    out, cur = [], None
    while True:
        p = {"node_type": node_type, "limit": 200}
        if cur:
            p["cursor"] = cur
        r = make_request("GET", f"{SUB}/nodes", params=p)
        out += r["items"]
        cur = r.get("next_cursor")
        if not cur:
            break
    return out


def get_node(uid):
    return make_request("GET", f"{SUB}/nodes/{uid}")


def mutate(deltas):
    return make_request("POST", f"{SUB}/mutations", body={"deltas": deltas})


def _create(node_type, title, properties, ref="n"):
    r = mutate([{"type": "create_node", "node_type": node_type, "ref": ref,
                 "title": title, "properties": properties}])
    return r["refs"][ref]


def _update(uid, updates):
    mutate([{"type": "update_node", "node_id": uid, "updates": updates}])


# ── §4 command traceability ────────────────────────────────────────────────
def omni_commands_folder():
    """Return the Omni-commands folder uuid; create it (root, kind=command) if gone."""
    for f in list_nodes("Folder"):
        p = f["properties"]
        if p.get("name") == "Omni-commands" and p.get("kind") == "command":
            return f["id"]
    return _create("Folder", "Omni-commands",
                   {"name": "Omni-commands", "kind": "command", "parent_folder_id": None},
                   ref="oc")


def save_command(name, command):
    """Save a SavedCommand into the Omni-commands folder (§4). Returns its uuid."""
    return _create("SavedCommand", _clip(name, 60),
                   {"name": _clip(name, 60), "command": command,
                    "folder_id": omni_commands_folder()}, ref="cmd")


def attach_command(stage_id, command_id):
    """Append a SavedCommand uuid to Stage.command_ids (§4)."""
    st = get_node(stage_id)["properties"]
    ids = list(st.get("command_ids") or [])
    if command_id not in ids:
        ids.append(command_id)
    _update(stage_id, {"command_ids": ids})


# ── §7 experiments / §6 stages ─────────────────────────────────────────────
def upsert_experiment(title, kind="freeform", description="", ref_url=""):
    """§7: append to an existing same-title experiment, else create one. Returns uuid."""
    want = title.strip().lower()
    matches = [e for e in list_nodes("Experiment")
               if (e["properties"].get("title") or e.get("title") or "").strip().lower() == want]
    if len(matches) > 1:
        raise ValueError(f"ambiguous experiment title {title!r}: {[m['id'] for m in matches]} — ask the user")
    if matches:
        return matches[0]["id"]
    return _create("Experiment", _clip(title, 60),
                   {"kind": kind, "description": _clip(description, 240) or "—",
                    "ref_url": ref_url or "", "experiment_created_at": None}, ref="exp")


def create_stage(experiment_id, one_liner, details, result, node_date,
                 run_ids=None, command_ids=None, pos=(0, 0)):
    """§6: create a Stage with every field populated, within limits. Returns uuid."""
    if "T" not in str(node_date):
        node_date = f"{node_date}T00:00:00"          # datetime needs the time part
    props = {
        "one_liner": _clip(one_liner, 60),
        "details": _clip(details, 240) or "—",
        "result": _clip(result, 240) or "pending",
        "node_date": node_date,
        "experiment_id": experiment_id,
        "run_ids": list(run_ids or []),
        "command_ids": list(command_ids or []),
        "flows_to": [],
        "run_set_ids": [],
        "pos_x": float(pos[0]), "pos_y": float(pos[1]),
    }
    return _create("Stage", _clip(one_liner, 60), props, ref="stage")


def set_stage_result(stage_id, result):
    _update(stage_id, {"result": _clip(result, 240) or "—"})


# ── §3 run linking ─────────────────────────────────────────────────────────
def find_run(wandb_id):
    """Find a Run node by its wandb_id ('entity/project/run_id'). Returns uuid or None."""
    for r in list_nodes("Run"):
        if r["properties"].get("wandb_id") == wandb_id:
            return r["id"]
    return None


def link_run(stage_id, run_uuid):
    """Append a Run uuid to Stage.run_ids (§3)."""
    st = get_node(stage_id)["properties"]
    ids = list(st.get("run_ids") or [])
    if run_uuid not in ids:
        ids.append(run_uuid)
    _update(stage_id, {"run_ids": ids})


# ── §5 failure log ─────────────────────────────────────────────────────────
_CATEGORIES = {"oom", "timeout", "crash", "config", "secret", "quota", "wandb", "infra", "other"}


def record_failure(summary, category, job_name="", cluster="", command="",
                   error_excerpt="", occurred_at=None, resolution="open", stage_id="none"):
    """§5: write a RunFailure to the central log. Every field populated. Returns uuid."""
    if category not in _CATEGORIES:
        category = "other"
    if occurred_at and "T" not in str(occurred_at):
        occurred_at = f"{occurred_at}T00:00:00"
    return _create("RunFailure", _clip(summary, 60), {
        "summary": _clip(summary, 120) or "failure",
        "category": category,
        "job_name": job_name or "n/a",
        "cluster": cluster or "n/a",
        "command": command or "n/a",
        "error_excerpt": _clip(error_excerpt, 1500) or "n/a",
        "occurred_at": occurred_at,          # datetime may be null if unknown
        "resolution": resolution or "open",
        "stage_id": stage_id or "none",
    }, ref="rf")
