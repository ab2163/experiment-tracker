"""Omni function: mirror WandB runs into experiment_tracker_core, project by project.

Registered in the schema's functionRegistry and invoked by the cron `wandb_ingest`
workflow. Returns a flat list of normalized run dicts; a downstream
create_nodes_batch (upsert on wandb_id) commits them. Ported from the standalone
tracker's wandb_client.scan_wandb / normalize_run, using httpx directly against
WandB's GraphQL API (no wandb package needed).

Env (workflow secrets): WANDB_API_KEY (required); WANDB_ENTITY (or pass entity=).

Project-by-project: lists every project in the entity, then scans each project's
runs with its own bounded pagination and error isolation, so one malformed
project can't sink the whole ingest and no single fetch holds the whole entity.
"""
import base64
import concurrent.futures
import json
import os
import re
import traceback
from datetime import datetime, timedelta

WANDB_URL = "https://api.wandb.ai/graphql"

_HP_SECTIONS = ("train", "model", "dataset", "harness")
_HARDWARE_RE = re.compile(
    r"(cpu|gpu|cluster|budget|device|node|ttl|worker|ray|hardware|image|timeout|n_cpus)",
    re.IGNORECASE,
)
_MAX_STR = 300

# The Run.state field is a 3-value enum (running/finished/crashed); WandB emits
# more states, so collapse them onto the enum. Unknown -> None (state is optional).
_STATE_MAP = {
    "finished": "finished",
    "running": "running",
    "pending": "running",
    "preempting": "running",
    "preempted": "running",
    "crashed": "crashed",
    "failed": "crashed",
    "killed": "crashed",
}


def _auth_header(api_key):
    tok = base64.b64encode(f"api:{api_key}".encode()).decode()
    return {"Authorization": f"Basic {tok}", "Content-Type": "application/json"}


def _gql(client, query, variables):
    resp = client.post(WANDB_URL, json={"query": query, "variables": variables})
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("errors"):
        raise RuntimeError(f"WandB GraphQL error: {payload['errors']}")
    return payload["data"]


def _parse_ts(v):
    if not v:
        return None
    return datetime.fromisoformat(
        str(v).replace("Z", "+00:00").replace(" ", "T")
    ).replace(tzinfo=None)


def _list_projects(client, entity):
    q = ("query($e:String!,$c:String){ projects(entityName:$e, first:200, after:$c){"
         " pageInfo{ hasNextPage endCursor } edges{ node{ name } } } }")
    names, cursor = [], None
    while True:
        data = _gql(client, q, {"e": entity, "c": cursor})["projects"]
        names += [e["node"]["name"] for e in data["edges"]]
        if not data["pageInfo"]["hasNextPage"]:
            break
        cursor = data["pageInfo"]["endCursor"]
    return names


def _iter_runs(client, entity, project, since_dt, until_dt):
    cond = {}
    if since_dt is not None:
        cond["$gte"] = since_dt.isoformat()
    if until_dt is not None:
        cond["$lte"] = until_dt.isoformat()
    filters = json.dumps({"created_at": cond}) if cond else None
    q = ("query($e:String!,$p:String!,$c:String,$filters:JSONString){"
         " project(name:$p,entityName:$e){"
         " runs(first:50, order:\"-created_at\", filters:$filters, after:$c){"
         " pageInfo{hasNextPage endCursor}"
         " edges{ node{ name displayName createdAt state commit"
         " user{username} config summaryMetrics } } } } }")
    cursor = None
    while True:
        proj = _gql(client, q, {"e": entity, "p": project, "c": cursor, "filters": filters})["project"]
        if not proj:
            return
        runs = proj["runs"]
        if not runs["edges"]:
            return
        for edge in runs["edges"]:
            node = edge["node"]
            cdt = _parse_ts(node.get("createdAt"))
            if cdt is None:
                continue
            if until_dt is not None and cdt > until_dt:
                continue  # newer than the window; keep descending
            if since_dt is not None and cdt < since_dt:
                return  # newest-first: everything past this is older too
            yield node
        if not runs["pageInfo"]["hasNextPage"]:
            return
        cursor = runs["pageInfo"]["endCursor"]


def _unwrap(section):
    if isinstance(section, dict) and set(section.keys()) <= {"value", "desc"}:
        return section.get("value")
    return section


def _flatten(prefix, value, out):
    if isinstance(value, dict):
        for k, v in value.items():
            if k.startswith("_") or _HARDWARE_RE.search(k):
                continue
            _flatten(f"{prefix}.{k}" if prefix else k, v, out)
    elif isinstance(value, list):
        if len(value) <= 20 and all(not isinstance(x, (dict, list)) for x in value):
            out[prefix] = value
    else:
        if isinstance(value, str) and len(value) > _MAX_STR:
            return
        out[prefix] = value


def _env_short(target):
    parts = target.split(".")
    return parts[1] if len(parts) > 1 else target


def _env_targets(config):
    """Environment `_target_`s from both config schemas: singular `environment`
    and the newer plural `environments` dict (multi-env skyrl runs)."""
    targets = []
    env = _unwrap(config.get("environment", {}))
    if isinstance(env, dict):
        t = env.get("_target_")
        if isinstance(t, str) and t.startswith("environments."):
            targets.append(t)
    envs = _unwrap(config.get("environments", {}))
    if isinstance(envs, dict):
        for _, v in sorted(envs.items()):
            v = _unwrap(v)
            if isinstance(v, dict):
                t = v.get("_target_")
                if isinstance(t, str) and t.startswith("environments."):
                    targets.append(t)
    return targets


def _normalize(entity, project, node):
    config = json.loads(node.get("config") or "{}")
    dataset = _unwrap(config.get("dataset", {})) or {}
    targets = _env_targets(config)
    environment = ",".join(sorted({_env_short(t) for t in targets})) if targets else ""
    run_id = node["name"]
    hp = {}
    for section in _HP_SECTIONS:
        _flatten(section, _unwrap(config.get(section, {})) or {}, hp)
    created = _parse_ts(node.get("createdAt"))
    raw_state = (node.get("state") or "").lower()
    return {
        "wandb_id": f"{entity}/{project}/{run_id}",
        "title": node.get("displayName") or run_id,
        "display_name": node.get("displayName") or run_id,
        "project": project,
        "url": f"https://wandb.ai/{entity}/{project}/runs/{run_id}",
        "user": (node.get("user") or {}).get("username") or "",
        "state": _STATE_MAP.get(raw_state),
        "run_created_at": created.isoformat() if created else None,
        "commit": node.get("commit") or "",
        "environment": environment,
        "batch_size": dataset.get("batch_size"),
        "group_size": dataset.get("group_size"),
        "hyperparameters": hp,
    }


def run(lookback_days=3, since=None, until=None, entity=None, workers=16):
    """Scan the entity project-by-project, `workers` projects at a time.

    `workers` is the Omni equivalent of the standalone tracker's INGEST_WORKERS:
    a thread pool of concurrent per-project scanners (WandB scanning is
    network-bound, so threads parallelize well despite the GIL). One shared
    httpx.Client is safe across threads (connection-pooled).

    Never raises: any top-level failure (missing dep, bad key, auth error) is
    caught and returned as data (outcome="error", error=...) so the downstream
    ingest-log delta can persist it as a readable node instead of the whole
    workflow failing opaquely.
    """
    since_str = since if isinstance(since, str) else None
    try:
        import httpx  # imported here so an ImportError is captured as data too

        api_key = os.environ["WANDB_API_KEY"]
        entity = entity or os.environ.get("WANDB_ENTITY") or "orbitalmaterials"
        since_dt = _parse_ts(since) if since else (datetime.utcnow() - timedelta(days=float(lookback_days)))
        until_dt = _parse_ts(until) if until else None
        since_str = since_dt.isoformat() if since_dt else None

        out, scanned, failed = [], 0, []
        with httpx.Client(timeout=60.0, headers=_auth_header(api_key)) as client:
            projects = _list_projects(client, entity)

            def scan(project):  # returns (project, runs, error)
                try:
                    rows = [_normalize(entity, project, n)
                            for n in _iter_runs(client, entity, project, since_dt, until_dt)]
                    return project, rows, None
                except Exception as e:  # isolate a bad project, keep going
                    return project, [], str(e)[:200]

            with concurrent.futures.ThreadPoolExecutor(max_workers=int(workers)) as pool:
                for project, rows, err in pool.map(scan, projects):
                    if err is None:
                        out.extend(rows)
                        scanned += 1
                    else:
                        failed.append({"project": project, "error": err})

        return {
            "runs": out,
            "run_count": len(out),
            "projects_scanned": scanned,
            "projects_failed": len(failed),
            "failures": failed[:20],
            "since": since_str,
            "outcome": "ok",
            "error": "",
            "log_summary": f"OK: {len(out)} runs from {scanned} projects "
                           f"({len(failed)} failed) since {since_str}",
        }
    except Exception as e:
        return {
            "runs": [],
            "run_count": 0,
            "projects_scanned": 0,
            "projects_failed": 0,
            "failures": [],
            "since": since_str,
            "outcome": "error",
            "error": (f"{type(e).__name__}: {e}\n" + traceback.format_exc())[:1500],
            "log_summary": f"ERROR: {type(e).__name__}: {e}"[:120],
        }
