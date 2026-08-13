import sqlite3, sys
sys.path.insert(0, "/shared/users/ajinkya/.curie-merged-skills/omni")
from omni_api import make_request

SCHEMA="experiment_tracker_core"; SG="default"
MUT=f"/schemas/{SCHEMA}/subgraphs/{SG}/mutations"

def iso(v):
    if not v: return None
    s=str(v).strip().replace(" ","T").split(".")[0]
    return s if s.endswith("Z") else s+"Z"

con=sqlite3.connect("experiment_data.db"); con.row_factory=sqlite3.Row
folders=[dict(r) for r in con.execute("SELECT * FROM folders")]
run_sets=[dict(r) for r in con.execute("SELECT name, folder_id FROM run_sets WHERE folder_id IS NOT NULL")]
commands=[dict(r) for r in con.execute("SELECT name, folder_id FROM saved_commands WHERE folder_id IS NOT NULL")]
con.close()

# --- map existing RunSet / SavedCommand nodes by name -> uuid (page them) ---
def name_map(node_type):
    m={}; cursor=None
    while True:
        params={"node_type":node_type,"limit":200}
        if cursor: params["cursor"]=cursor
        d=make_request("GET", f"/schemas/{SCHEMA}/subgraphs/{SG}/nodes", params=params)
        for n in d["items"]:
            m[(n.get("properties") or {}).get("name") or n.get("title")]=n["id"]
        cursor=d.get("next_cursor")
        if not cursor: break
    return m
rs_map=name_map("RunSet"); cmd_map=name_map("SavedCommand")
print(f"mapped {len(rs_map)} run sets, {len(cmd_map)} commands")

# --- Pass A: create Folder nodes, capture db_id -> omni uuid ---
deltasA=[]
for f in folders:
    deltasA.append({"type":"create_node","node_type":"Folder","ref":f"f_{f['id']}",
                    "title":f["name"],
                    "properties":{"name":f["name"],"kind":f["kind"],
                                  "folder_created_at":iso(f.get("created_at"))}})
respA=make_request("POST", MUT, body={"deltas":deltasA})
refs=respA.get("refs",{})
fmap={f["id"]: refs.get(f"f_{f['id']}") for f in folders}
print(f"created {len([v for v in fmap.values() if v])} folders")

# --- Pass B: set folder parents + run-set/command folder_id via update_node ---
deltasB=[]
for f in folders:
    if f.get("parent_id") and fmap.get(f["id"]) and fmap.get(f["parent_id"]):
        deltasB.append({"type":"update_node","node_id":fmap[f["id"]],
                        "updates":{"parent_folder_id":fmap[f["parent_id"]]}})
miss_rs=miss_cmd=0
for r in run_sets:
    uuid=rs_map.get(r["name"]); fuid=fmap.get(r["folder_id"])
    if uuid and fuid: deltasB.append({"type":"update_node","node_id":uuid,"updates":{"folder_id":fuid}})
    else: miss_rs+=1
for c in commands:
    uuid=cmd_map.get(c["name"]); fuid=fmap.get(c["folder_id"])
    if uuid and fuid: deltasB.append({"type":"update_node","node_id":uuid,"updates":{"folder_id":fuid}})
    else: miss_cmd+=1
print(f"pass B deltas: {len(deltasB)} (unmatched run_sets={miss_rs}, commands={miss_cmd})")
respB=make_request("POST", MUT, body={"deltas":deltasB})
print("pass B committed:", "ok" if isinstance(respB,dict) else respB)
