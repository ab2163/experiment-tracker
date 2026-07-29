import type {
  EnvironmentCount,
  Experiment,
  ExperimentKind,
  Graph,
  GraphEdge,
  GraphNode,
  ImportDbResult,
  ProjectCount,
  RunList,
  RunSet,
  SyncStatus,
  UserCount,
  WandbSyncResult,
} from "./types";

/** A set of run filters. Array dimensions are multi-select (repeated params). */
export interface RunFilters {
  environment?: string[];
  project?: string[];
  user?: string[];
  date_from?: string;
  date_to?: string;
}

export interface RunQuery extends RunFilters {
  limit?: number;
  offset?: number;
}

/** Build a query string, repeating array values (e.g. ?environment=a&environment=b). */
function buildParams(q: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((item) => params.append(k, String(item)));
    else params.set(k, String(v));
  }
  return params.toString();
}

export async function fetchRuns(q: RunQuery): Promise<RunList> {
  const res = await fetch(`/api/runs?${buildParams(q as Record<string, unknown>)}`);
  if (!res.ok) throw new Error(`Failed to load runs: ${res.status}`);
  return res.json();
}

export async function fetchEnvironments(
  f: Omit<RunFilters, "environment"> = {}
): Promise<EnvironmentCount[]> {
  const res = await fetch(`/api/environments?${buildParams(f as Record<string, unknown>)}`);
  if (!res.ok) throw new Error(`Failed to load environments: ${res.status}`);
  return res.json();
}

export async function fetchProjects(
  f: Omit<RunFilters, "project"> = {}
): Promise<ProjectCount[]> {
  const res = await fetch(`/api/projects?${buildParams(f as Record<string, unknown>)}`);
  if (!res.ok) throw new Error(`Failed to load projects: ${res.status}`);
  return res.json();
}

export async function fetchUsers(
  f: Omit<RunFilters, "user"> = {}
): Promise<UserCount[]> {
  const res = await fetch(`/api/users?${buildParams(f as Record<string, unknown>)}`);
  if (!res.ok) throw new Error(`Failed to load users: ${res.status}`);
  return res.json();
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

const POST = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchExperiments(): Promise<Experiment[]> {
  return jsonOrThrow(await fetch("/api/experiments"));
}

export async function createExperiment(payload: {
  title: string;
  kind: ExperimentKind;
  ref_url?: string;
  description?: string;
}): Promise<Experiment> {
  return jsonOrThrow(await fetch("/api/experiments", POST(payload)));
}

export async function updateExperiment(
  experimentId: string,
  payload: { title?: string; kind?: ExperimentKind; ref_url?: string | null; description?: string | null }
): Promise<Experiment> {
  return jsonOrThrow(
    await fetch(`/api/experiments/${experimentId}`, { ...POST(payload), method: "PATCH" })
  );
}

export async function fetchGraph(experimentId: string): Promise<Graph> {
  return jsonOrThrow(await fetch(`/api/experiments/${experimentId}/graph`));
}

export async function createNode(
  experimentId: string,
  payload: { one_liner: string; node_date?: string; result?: string; run_ids: string[]; run_set_id?: string }
): Promise<GraphNode> {
  return jsonOrThrow(await fetch(`/api/experiments/${experimentId}/nodes`, POST(payload)));
}

export async function setNodeRunSet(nodeId: string, runSetId: string): Promise<GraphNode> {
  return jsonOrThrow(await fetch(`/api/nodes/${nodeId}/run-set`, POST({ run_set_id: runSetId })));
}

export async function updateNode(
  nodeId: string,
  payload: { one_liner?: string; node_date?: string; result?: string }
): Promise<GraphNode> {
  return jsonOrThrow(
    await fetch(`/api/nodes/${nodeId}`, { ...POST(payload), method: "PATCH" })
  );
}

export async function createEdge(
  experimentId: string,
  payload: { source_id: string; target_id: string }
): Promise<GraphEdge> {
  return jsonOrThrow(await fetch(`/api/experiments/${experimentId}/edges`, POST(payload)));
}

export async function deleteExperiment(experimentId: string): Promise<void> {
  const res = await fetch(`/api/experiments/${experimentId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete experiment: ${res.status}`);
}

export async function deleteNode(nodeId: string): Promise<void> {
  const res = await fetch(`/api/nodes/${nodeId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete node: ${res.status}`);
}

export async function deleteEdge(edgeId: string): Promise<void> {
  const res = await fetch(`/api/edges/${edgeId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete edge: ${res.status}`);
}

export async function addRunsToNode(nodeId: string, runIds: string[]): Promise<GraphNode> {
  return jsonOrThrow(await fetch(`/api/nodes/${nodeId}/runs`, POST(runIds)));
}

export async function removeRunFromNode(nodeId: string, runId: string): Promise<GraphNode> {
  // run ids contain slashes; the backend route is a :path converter, so leave them raw.
  return jsonOrThrow(await fetch(`/api/nodes/${nodeId}/runs/${runId}`, { method: "DELETE" }));
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  return jsonOrThrow(await fetch("/api/sync/status"));
}

export async function syncWandb(payload: {
  since: string;
  until?: string;
}): Promise<WandbSyncResult> {
  return jsonOrThrow(await fetch("/api/sync/wandb", POST(payload)));
}

export async function importDbFile(file: File): Promise<ImportDbResult> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/sync/import-db", { method: "POST", body: fd }));
}

export async function fetchRunSets(): Promise<RunSet[]> {
  return jsonOrThrow(await fetch("/api/run-sets"));
}

export async function createRunSet(payload: { name: string; run_ids: string[] }): Promise<RunSet> {
  return jsonOrThrow(await fetch("/api/run-sets", POST(payload)));
}

export async function mergeRunSets(payload: { name: string; source_ids: string[] }): Promise<RunSet> {
  return jsonOrThrow(await fetch("/api/run-sets/merge", POST(payload)));
}

export async function renameRunSet(runSetId: string, name: string): Promise<RunSet> {
  return jsonOrThrow(await fetch(`/api/run-sets/${runSetId}`, { ...POST({ name }), method: "PATCH" }));
}

export async function deleteRunSet(runSetId: string): Promise<void> {
  const res = await fetch(`/api/run-sets/${runSetId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete run set: ${res.status}`);
}

export async function addRunsToRunSet(runSetId: string, runIds: string[]): Promise<RunSet> {
  return jsonOrThrow(await fetch(`/api/run-sets/${runSetId}/runs`, POST(runIds)));
}

export async function removeRunFromRunSet(runSetId: string, runId: string): Promise<RunSet> {
  // run ids contain slashes; backend route is a :path converter, leave raw.
  return jsonOrThrow(await fetch(`/api/run-sets/${runSetId}/runs/${runId}`, { method: "DELETE" }));
}
