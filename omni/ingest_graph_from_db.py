"""Import the tracker graph (experiments, stages, run sets, saved commands and
their edges) from a tracker SQLite .db into experiment_tracker_core.

Runs must already be present (run ingest_from_db.py first) — this wires edges to
them by wandb_id. Idempotent-ish: nodes here are not upsert types, so re-running
would duplicate the graph; intended as a one-shot testing import.
"""
import sqlite3
import sys

sys.path.insert(0, "/shared/users/ajinkya/.curie-merged-skills/omni")
from omni_api import make_request  # noqa: E402

SCHEMA = "experiment_tracker_core"
SG = "default"
MUT = f"/schemas/{SCHEMA}/subgraphs/{SG}/nodes"  # placeholder, set below
MUT = f"/schemas/{SCHEMA}/subgraphs/{SG}/mutations"
DB = sys.argv[1] if len(sys.argv) > 1 else "experiment_data.db"
_KINDS = {"linear", "pr", "freeform"}


def iso(v):
    if not v:
        return None
    s = str(v).strip()
    if "T" not in s and " " not in s:  # date-only (e.g. "2026-07-29")
        s += "T00:00:00"
    return s.replace(" ", "T").split(".")[0] + "Z"


def commit(deltas, label):
    resp = make_request("POST", MUT, body={"deltas": deltas})
    refs = resp.get("refs", {}) if isinstance(resp, dict) else {}
    print(f"  {label}: committed {len(deltas)} deltas, {len(refs)} refs")
    return refs


con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
experiments = [dict(r) for r in con.execute("SELECT * FROM experiments")]
stages = [dict(r) for r in con.execute("SELECT * FROM nodes")]
node_edges = [dict(r) for r in con.execute("SELECT * FROM node_edges")]
node_runs = [dict(r) for r in con.execute("SELECT * FROM node_runs")]
run_sets = [dict(r) for r in con.execute("SELECT * FROM run_sets")]
run_set_runs = [dict(r) for r in con.execute("SELECT * FROM run_set_runs")]
commands = [dict(r) for r in con.execute("SELECT * FROM saved_commands")]
node_commands = [dict(r) for r in con.execute("SELECT * FROM node_commands")]
con.close()

# --- run map: wandb_id -> Omni node id (page through Run nodes) ---
print("building Run map...")
run_map, cursor = {}, None
while True:
    params = {"node_type": "Run", "limit": 200}
    if cursor:
        params["cursor"] = cursor
    d = make_request("GET", f"/schemas/{SCHEMA}/subgraphs/{SG}/nodes", params=params)
    for n in d["items"]:
        run_map[n["properties"].get("wandb_id")] = n["id"]
    cursor = d.get("next_cursor")
    if not cursor:
        break
print(f"  {len(run_map)} runs mapped")

# --- Phase 1: experiments + stages + HAS_STAGE + FLOWS_TO + USES_RUN ---
deltas = []
for e in experiments:
    props = {"ref_url": e.get("ref_url") or "", "description": e.get("description") or "",
             "experiment_created_at": iso(e.get("created_at"))}
    if (e.get("kind") or "") in _KINDS:
        props["kind"] = e["kind"]
    deltas.append({"type": "create_node", "node_type": "Experiment", "ref": f"e_{e['id']}",
                   "title": e["title"], "properties": props})
for s in stages:
    deltas.append({"type": "create_node", "node_type": "Stage", "ref": f"s_{s['id']}",
                   "title": s["one_liner"],
                   "properties": {"one_liner": s["one_liner"], "node_date": iso(s.get("node_date")),
                                  "result": s.get("result") or ""}})
has_stage = [{"from_node": {"ref": f"e_{s['experiment_id']}"}, "to_node": {"ref": f"s_{s['id']}"}}
             for s in stages if s.get("experiment_id")]
flows = [{"from_node": {"ref": f"s_{ne['source_id']}"}, "to_node": {"ref": f"s_{ne['target_id']}"}}
         for ne in node_edges]
uses = [{"from_node": {"ref": f"s_{nr['node_id']}"}, "to_node": run_map[nr["run_id"]]}
        for nr in node_runs if nr["run_id"] in run_map]
deltas.append({"type": "create_edges_batch", "edge_type": "HAS_STAGE", "items": has_stage})
deltas.append({"type": "create_edges_batch", "edge_type": "FLOWS_TO", "items": flows})
deltas.append({"type": "create_edges_batch", "edge_type": "USES_RUN", "items": uses})
refs = commit(deltas, "experiments+stages")
stage_uuid = {s["id"]: refs.get(f"s_{s['id']}") for s in stages}

# --- Phase 2: run sets + RUN_SET_HAS_RUN ---
deltas = []
for rs in run_sets:
    deltas.append({"type": "create_node", "node_type": "RunSet", "ref": f"rs_{rs['id']}",
                   "title": rs["name"],
                   "properties": {"name": rs["name"], "short_id": rs.get("short_id") or "",
                                  "rs_created_at": iso(rs.get("created_at"))}})
rs_runs = [{"from_node": {"ref": f"rs_{x['run_set_id']}"}, "to_node": run_map[x["run_id"]]}
           for x in run_set_runs if x["run_id"] in run_map]
deltas.append({"type": "create_edges_batch", "edge_type": "RUN_SET_HAS_RUN", "items": rs_runs})
commit(deltas, "run sets")

# --- Phase 3: saved commands + STAGE_USES_COMMAND ---
deltas = []
for c in commands:
    deltas.append({"type": "create_node", "node_type": "SavedCommand", "ref": f"c_{c['id']}",
                   "allow_orphan": True, "title": c["name"],
                   "properties": {"name": c["name"], "command": c.get("command") or ""}})
cmd_edges = [{"from_node": stage_uuid[nc["node_id"]], "to_node": {"ref": f"c_{nc['command_id']}"}}
             for nc in node_commands if stage_uuid.get(nc["node_id"])]
deltas.append({"type": "create_edges_batch", "edge_type": "STAGE_USES_COMMAND", "items": cmd_edges})
commit(deltas, "commands")

print("DONE")
