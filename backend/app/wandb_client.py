"""WandB GraphQL client + run normalization.

Runs are scattered across ~950 WandB projects, so we scan every project
newest-first and stop as soon as we cross the ingest date cutoff. OptPrime
config sections (environment/dataset/train/harness) are captured when present;
other runs simply store with those fields blank.
"""
from __future__ import annotations

import base64
import json
import re
from datetime import datetime
from typing import Optional, Any, Iterator

import httpx

from .config import settings

# Config sections whose leaf values are treated as hyperparameters.
_HP_SECTIONS = ("train", "model", "dataset", "harness")

# Leaf keys that are hardware/infra, not scientific hyperparameters — excluded.
_HARDWARE_RE = re.compile(
    r"(cpu|gpu|cluster|budget|device|node|ttl|worker|ray|hardware|image|timeout|n_cpus)",
    re.IGNORECASE,
)
_MAX_STR = 300  # drop long strings (prompts / templates) from the hyperparam view


def _auth_header() -> dict[str, str]:
    tok = base64.b64encode(f"api:{settings.wandb_api_key}".encode()).decode()
    return {"Authorization": f"Basic {tok}", "Content-Type": "application/json"}


def _parse_ts(v: Any) -> Optional[datetime]:
    """Parse a WandB/ISO timestamp (or pass through a datetime) to a naive UTC datetime."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=None)
    return datetime.fromisoformat(str(v).replace("Z", "+00:00").replace(" ", "T")).replace(tzinfo=None)


class WandbClient:
    def __init__(self, client: Optional[httpx.Client] = None):
        self._client = client or httpx.Client(timeout=60.0, headers=_auth_header())

    def _gql(self, query: str, variables: Optional[dict] = None) -> dict:
        resp = self._client.post(
            settings.wandb_base_url, json={"query": query, "variables": variables or {}}
        )
        resp.raise_for_status()
        payload = resp.json()
        if "errors" in payload and payload["errors"]:
            raise RuntimeError(f"WandB GraphQL error: {payload['errors']}")
        return payload["data"]

    def list_projects(self) -> list[str]:
        q = """query($e:String!,$c:String){ projects(entityName:$e, first:200, after:$c){
          pageInfo{ hasNextPage endCursor } edges{ node{ name } } } }"""
        names: list[str] = []
        cursor = None
        while True:
            data = self._gql(q, {"e": settings.wandb_entity, "c": cursor})["projects"]
            names += [e["node"]["name"] for e in data["edges"]]
            if not data["pageInfo"]["hasNextPage"]:
                break
            cursor = data["pageInfo"]["endCursor"]
        return names

    def iter_runs_since(
        self, project: str, since: Any, until: Any = None
    ) -> Iterator[dict]:
        """Yield raw run nodes in `project` created in [`since`, `until`].

        `since`/`until` may be ISO8601 strings or datetimes; `until=None` means
        "up to now" (no upper bound).

        Correctness does not rely on result ordering: the query filters
        server-side on `created_at`, so WandB only returns runs inside the
        window. It also orders newest-first (`-created_at`, the key WandB's own
        client uses) so the early `return` below is a cheap optimization, and a
        client-side window check remains as a safety net in case the server-side
        filter is ignored.
        """
        since_dt = _parse_ts(since)
        until_dt = _parse_ts(until)

        cond: dict[str, str] = {}
        if since_dt is not None:
            cond["$gte"] = since_dt.isoformat()
        if until_dt is not None:
            cond["$lte"] = until_dt.isoformat()
        filters = json.dumps({"created_at": cond}) if cond else None

        q = """query($e:String!,$p:String!,$c:String,$filters:JSONString){ project(name:$p,entityName:$e){
          runs(first:50, order:"-created_at", filters:$filters, after:$c){ pageInfo{hasNextPage endCursor}
            edges{ node{ name displayName createdAt state commit
              user{username} config summaryMetrics } } } } }"""
        cursor = None
        while True:
            proj = self._gql(
                q,
                {"e": settings.wandb_entity, "p": project, "c": cursor, "filters": filters},
            )["project"]
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
                    return  # newest-first: everything after this is older too
                yield node
            if not runs["pageInfo"]["hasNextPage"]:
                return
            cursor = runs["pageInfo"]["endCursor"]


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def _unwrap(section: Any) -> Any:
    """Top-level WandB config values are wrapped as {'value':..,'desc':..}."""
    if isinstance(section, dict) and "value" in section and "desc" in section:
        return section["value"]
    if isinstance(section, dict) and set(section.keys()) <= {"value", "desc"}:
        return section.get("value")
    return section


def _flatten(prefix: str, value: Any, out: dict[str, Any]) -> None:
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


def env_short_name(target: str) -> str:
    """`environments.circle_packing.circle_packing_definition.CirclePacking` -> `circle_packing`."""
    parts = target.split(".")
    return parts[1] if len(parts) > 1 else target


def _env_targets(config: dict) -> list[str]:
    """Environment `_target_` strings, supporting both config schemas:
      * old: a single `environment` dict with a `_target_`
      * new: an `environments` dict of {name: env-config} (multi-env skyrl runs)
    Returns the ones pointing at an `environments.` module, in a stable order.
    """
    targets: list[str] = []

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


def normalize_run(project: str, node: dict) -> dict:
    config = json.loads(node.get("config") or "{}")
    summary = json.loads(node.get("summaryMetrics") or "{}")

    dataset = _unwrap(config.get("dataset", {})) or {}
    train = _unwrap(config.get("train", {})) or {}

    # Environment(s): old schema has one `environment`, new skyrl runs have an
    # `environments` dict. env_target keeps the first target; environment is the
    # (comma-joined) short name(s) so multi-env runs stay filterable.
    targets = _env_targets(config)
    target = targets[0] if targets else ""
    environment = ",".join(sorted({env_short_name(t) for t in targets})) if targets else ""
    entity = settings.wandb_entity
    run_id = node["name"]

    hyperparameters: dict[str, Any] = {}
    for section in _HP_SECTIONS:
        _flatten(section, _unwrap(config.get(section, {})) or {}, hyperparameters)

    created = datetime.fromisoformat(node["createdAt"].replace("Z", "+00:00")).replace(tzinfo=None)

    return {
        "id": f"{entity}/{project}/{run_id}",
        "wandb_run_id": run_id,
        "project": project,
        "entity": entity,
        "display_name": node.get("displayName") or run_id,
        "url": f"https://wandb.ai/{entity}/{project}/runs/{run_id}",
        "user": (node.get("user") or {}).get("username"),
        "state": node.get("state"),
        "created_at": created,
        "commit": node.get("commit"),
        "env_target": target,
        "environment": environment,
        "batch_size": dataset.get("batch_size"),
        "group_size": dataset.get("group_size"),
        "epochs_configured": train.get("n_epochs"),
        "epochs_achieved": summary.get("progress/epoch"),
        "hyperparameters": hyperparameters,
    }
