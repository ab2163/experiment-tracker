#!/usr/bin/env python3
"""Resource-limit gate for autonomous OptPrime submits (PROTOCOLS §2).

Per user, across ALL clusters, counting active (non-terminal) GPU pods:
    have + need <= 16  -> priority "med"
    16 < have+need <= 32 -> priority "low"
    have + need  > 32  -> REFUSE (exit 3)

Usage:
    # need from an explicit GPU count:
    python preflight.py --user ajinkya --gpus 2
    # need parsed from a saved `remote.submit ... --dry-run` payload:
    python preflight.py --user ajinkya --dry-run-json payload.json

`--user` accepts an email or a username; matched against pod label `username`
(the platform derives it from the email local-part).

Env: PLATFORM_API_URL, ORBITAL_API_KEY (present in the Curie sandbox).
Exit codes: 0 submit@med, 1 submit@low, 3 REFUSE, 2 usage/error. The chosen
priority is printed on stdout as `priority=med|low` for scripting.
"""
import argparse, json, os, sys, urllib.request

CLUSTERS = ["aws", "civo", "nebius"]
CAP_MED = 16      # ≤ this many total GPUs -> med priority
CAP_MAX = 32      # ≤ this many -> low priority; above -> refuse
# Pod statuses that no longer hold / await a GPU.
TERMINAL = {"Succeeded", "Failed", "Completed", "Terminated", "Unknown"}


def _get(path):
    base = os.environ["PLATFORM_API_URL"].rstrip("/")
    req = urllib.request.Request(base + path, headers={"X-API-Key": os.environ["ORBITAL_API_KEY"]})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read())


def load_dry_run(path):
    """Load a remote.submit --dry-run payload, tolerating a preamble line such as
    'Using git branch: origin/main (pinned to ...)' printed before the JSON."""
    text = open(path).read()
    i = text.find("{")
    if i < 0:
        raise ValueError("no JSON object found in dry-run output")
    return json.loads(text[i:])


def gpus_from_dry_run(payload):
    """Sum GPU-bearing sidecars in a remote.submit --dry-run payload."""
    n = int(payload.get("n_gpus", 0) or 0)  # main worker (normally 0)
    for s in payload.get("sidecars", []) or []:
        n += int(s.get("n_gpus", 0) or 0)   # skyrl sidecar carries the GPUs
    return n


def user_active_gpus(user):
    """Sum gpu_requested over the user's non-terminal GPU pods across clusters."""
    uname = user.split("@")[0].lower()
    total, detail = 0, []
    for c in CLUSTERS:
        try:
            pods = _get(f"/api/clusters/{c}/pods?namespace=core-gpu").get("pods", [])
        except Exception as e:
            print(f"  warn: could not list {c} pods: {e}", file=sys.stderr)
            continue
        for p in pods:
            if (p.get("gpu_requested") or 0) <= 0:
                continue
            if p.get("status") in TERMINAL:
                continue
            lbl = p.get("labels") or {}
            if (lbl.get("username") or "").lower() != uname:
                continue
            g = int(p["gpu_requested"])
            total += g
            detail.append((c, p.get("job_name"), p.get("status"), g))
    return total, detail


def decide(have, need):
    total = have + need
    if total <= CAP_MED:
        return "med", 0
    if total <= CAP_MAX:
        return "low", 1
    return None, 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True, help="requesting user (email or username)")
    ap.add_argument("--gpus", type=int, help="GPUs this job needs")
    ap.add_argument("--dry-run-json", help="path to a remote.submit --dry-run payload JSON")
    args = ap.parse_args()

    if args.dry_run_json:
        need = gpus_from_dry_run(load_dry_run(args.dry_run_json))
    elif args.gpus is not None:
        need = args.gpus
    else:
        print("provide --gpus or --dry-run-json", file=sys.stderr); sys.exit(2)

    have, detail = user_active_gpus(args.user)
    tier, code = decide(have, need)

    print(f"user={args.user} have={have} need={need} total={have+need} "
          f"(cap med≤{CAP_MED}, max≤{CAP_MAX})")
    for c, job, st, g in detail:
        print(f"  active: {c} {job} [{st}] {g} GPU")
    if tier is None:
        print(f"REFUSE: {have}+{need}={have+need} exceeds the {CAP_MAX}-GPU cap. "
              f"Free capacity before submitting.")
    else:
        print(f"priority={tier}")
    sys.exit(code)


if __name__ == "__main__":
    main()
