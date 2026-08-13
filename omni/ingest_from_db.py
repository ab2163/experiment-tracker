"""Testing-only ingest: populate experiment_tracker_core with Run nodes from a
tracker SQLite .db file (the WandB live ingest's offline counterpart).

Reads the `runs` table, maps each row onto the Run node type, and upserts them
into the Omni graph in chunks via the mutations endpoint. Idempotent: Run has
identity="upsert" on wandb_id, so re-running reuses nodes instead of duplicating.

Usage:
    python ingest_from_db.py [DB_PATH] [--schema experiment_tracker_core]
                             [--subgraph default] [--chunk 100] [--limit N]
"""
import argparse
import json
import sqlite3
import sys

sys.path.insert(0, "/shared/users/ajinkya/.curie-merged-skills/omni")
from omni_api import make_request  # noqa: E402

# WandB emits more states than the Run.state enum (running/finished/crashed).
_STATE_MAP = {
    "finished": "finished", "running": "running", "pending": "running",
    "preempting": "running", "preempted": "running",
    "crashed": "crashed", "failed": "crashed", "killed": "crashed",
}


def _iso(v):
    if not v:
        return None
    return str(v).replace(" ", "T").split(".")[0] + "Z"


def _row_to_delta(r):
    hp = r.get("hyperparameters")
    try:
        hp = json.loads(hp) if isinstance(hp, str) and hp else {}
    except json.JSONDecodeError:
        hp = {}
    props = {
        "wandb_id": r["id"],
        "display_name": r.get("display_name") or r["id"],
        "project": r.get("project") or "",
        "url": r.get("url") or "",
        "user": r.get("user") or "",
        "commit": r.get("commit") or "",
        "environment": r.get("environment") or "",
        "hyperparameters": hp,
    }
    state = _STATE_MAP.get((r.get("state") or "").lower())
    if state:
        props["state"] = state
    if _iso(r.get("created_at")):
        props["run_created_at"] = _iso(r.get("created_at"))
    for k in ("batch_size", "group_size"):
        if r.get(k) is not None:
            props[k] = r[k]
    # Run.identity == "upsert" -> create_node dedupes on wandb_id (idempotent).
    # allow_orphan: Run is non-rootable (USES_RUN targets it) but runs stand alone
    # at ingest (linked to Stages later), so opt out of the connectivity rule.
    return {"type": "create_node", "node_type": "Run", "allow_orphan": True,
            "title": props["display_name"], "properties": props}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("db", nargs="?", default="experiment-tracker-demo/ablation.db")
    ap.add_argument("--schema", default="experiment_tracker_core")
    ap.add_argument("--subgraph", default="default")
    ap.add_argument("--chunk", type=int, default=100)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    q = "SELECT * FROM runs" + (f" LIMIT {args.limit}" if args.limit else "")
    rows = [dict(r) for r in con.execute(q)]
    con.close()
    print(f"read {len(rows)} runs from {args.db}")

    path = f"/schemas/{args.schema}/subgraphs/{args.subgraph}/mutations"
    total, failed_chunks = 0, 0
    for i in range(0, len(rows), args.chunk):
        chunk = rows[i:i + args.chunk]
        deltas = [_row_to_delta(r) for r in chunk]
        try:
            make_request("POST", path, body={"deltas": deltas})
            total += len(deltas)
            print(f"  committed {total}/{len(rows)}")
        except Exception as e:
            failed_chunks += 1
            print(f"  CHUNK {i}-{i+len(chunk)} FAILED: {str(e)[:200]}", file=sys.stderr)
    print(f"DONE: upserted ~{total} Run nodes ({failed_chunks} failed chunks)")


if __name__ == "__main__":
    main()
