import type {
  EnvironmentCount,
  Experiment,
  ExperimentKind,
  Folder,
  FolderKind,
  Graph,
  GraphEdge,
  GraphNode,
  Improvement,
  ImprovementStatus,
  ImportDbResult,
  Priority,
  ProjectCount,
  RunList,
  RunSet,
  SavedCommand,
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
  payload: {
    one_liner: string;
    node_date?: string;
    result?: string;
    run_ids: string[];
    command_ids?: string[];
    run_set_id?: string;
  }
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

export async function setNodePosition(nodeId: string, x: number, y: number): Promise<GraphNode> {
  return jsonOrThrow(
    await fetch(`/api/nodes/${nodeId}/position`, { ...POST({ x, y }), method: "PATCH" })
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

export async function addCommandsToNode(nodeId: string, commandIds: string[]): Promise<GraphNode> {
  return jsonOrThrow(await fetch(`/api/nodes/${nodeId}/commands`, POST(commandIds)));
}

export async function removeCommandFromNode(nodeId: string, commandId: string): Promise<GraphNode> {
  return jsonOrThrow(await fetch(`/api/nodes/${nodeId}/commands/${commandId}`, { method: "DELETE" }));
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

export async function createRunSet(payload: {
  name: string;
  run_ids: string[];
  folder_id?: string | null;
}): Promise<RunSet> {
  return jsonOrThrow(await fetch("/api/run-sets", POST(payload)));
}

export async function mergeRunSets(payload: {
  name: string;
  source_ids: string[];
  folder_id?: string | null;
}): Promise<RunSet> {
  return jsonOrThrow(await fetch("/api/run-sets/merge", POST(payload)));
}

export async function moveRunSet(runSetId: string, folderId: string | null): Promise<RunSet> {
  return jsonOrThrow(
    await fetch(`/api/run-sets/${runSetId}/folder`, { ...POST({ folder_id: folderId }), method: "PATCH" })
  );
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

export async function fetchSavedCommands(): Promise<SavedCommand[]> {
  return jsonOrThrow(await fetch("/api/saved-commands"));
}

export async function createSavedCommand(payload: {
  name: string;
  command: string;
  folder_id?: string | null;
}): Promise<SavedCommand> {
  return jsonOrThrow(await fetch("/api/saved-commands", POST(payload)));
}

export async function moveSavedCommand(commandId: string, folderId: string | null): Promise<SavedCommand> {
  return jsonOrThrow(
    await fetch(`/api/saved-commands/${commandId}/folder`, {
      ...POST({ folder_id: folderId }),
      method: "PATCH",
    })
  );
}

export async function updateSavedCommand(
  commandId: string,
  payload: { name: string; command: string }
): Promise<SavedCommand> {
  return jsonOrThrow(
    await fetch(`/api/saved-commands/${commandId}`, { ...POST(payload), method: "PATCH" })
  );
}

export async function deleteSavedCommand(commandId: string): Promise<void> {
  const res = await fetch(`/api/saved-commands/${commandId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete command: ${res.status}`);
}

export async function fetchImprovements(): Promise<Improvement[]> {
  return jsonOrThrow(await fetch("/api/improvements"));
}

export async function createImprovement(payload: {
  title: string;
  description?: string | null;
  priority?: Priority | null;
  status?: ImprovementStatus;
}): Promise<Improvement> {
  return jsonOrThrow(await fetch("/api/improvements", POST(payload)));
}

export async function updateImprovement(
  improvementId: string,
  payload: {
    title?: string;
    description?: string | null;
    priority?: Priority | null;
    status?: ImprovementStatus;
  }
): Promise<Improvement> {
  return jsonOrThrow(
    await fetch(`/api/improvements/${improvementId}`, { ...POST(payload), method: "PATCH" })
  );
}

export async function deleteImprovement(improvementId: string): Promise<void> {
  const res = await fetch(`/api/improvements/${improvementId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete improvement: ${res.status}`);
}

export async function fetchFolders(kind: FolderKind): Promise<Folder[]> {
  return jsonOrThrow(await fetch(`/api/folders?kind=${kind}`));
}

export async function createFolder(payload: {
  kind: FolderKind;
  name: string;
  parent_id?: string | null;
}): Promise<Folder> {
  return jsonOrThrow(await fetch("/api/folders", POST(payload)));
}

export async function renameFolder(folderId: string, name: string): Promise<Folder> {
  return jsonOrThrow(
    await fetch(`/api/folders/${folderId}`, { ...POST({ name }), method: "PATCH" })
  );
}

export async function moveFolder(folderId: string, parentId: string | null): Promise<Folder> {
  return jsonOrThrow(
    await fetch(`/api/folders/${folderId}/move`, { ...POST({ parent_id: parentId }), method: "PATCH" })
  );
}

export async function deleteFolder(folderId: string): Promise<void> {
  const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete folder: ${res.status}`);
}
