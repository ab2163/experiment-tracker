export interface Run {
  id: string;
  display_name: string;
  project: string;
  url: string;
  user: string | null;
  state: string | null;
  created_at: string;
  commit: string | null;
  environment: string;
  env_target: string;
  composite_version: string | null;
  batch_size: number | null;
  group_size: number | null;
  epochs_configured: number | null;
  epochs_achieved: number | null;
  hyperparameters: Record<string, unknown>;
}

export interface RunList {
  total: number;
  runs: Run[];
}

export interface EnvironmentCount {
  environment: string;
  count: number;
}

export interface ProjectCount {
  project: string;
  count: number;
}

export interface UserCount {
  user: string | null;
  count: number;
}

export interface RunSet {
  id: string;
  name: string;
  short_id: string | null;
  created_at: string;
  run_count: number;
  runs: RunSummary[];
}

export type ExperimentKind = "linear" | "pr" | "freeform";

export interface Experiment {
  id: string;
  title: string;
  kind: ExperimentKind;
  ref_url: string | null;
  description: string | null;
  created_at: string;
  node_count: number;
}

export interface RunSummary {
  id: string;
  display_name: string;
  url: string;
  environment: string;
  commit: string | null;
  state: string | null;
  epochs_achieved: number | null;
}

export interface GraphNode {
  id: string;
  experiment_id: string;
  one_liner: string;
  node_date: string;
  result: string | null;
  created_at: string;
  runs: RunSummary[];
  run_count: number;
  environments: string[];
  commits: string[];
  run_set_badge: string | null;
}

export interface GraphEdge {
  id: string;
  source_id: string;
  target_id: string;
}

export interface Graph {
  experiment: Experiment;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- Data loading / sync ---

export interface SyncStatus {
  last_run_created_at: string | null;
  run_count: number;
  sync_enabled: boolean;
}

export interface WandbSyncResult {
  added: number;
  updated: number;
  skipped: number;
  scanned: number;
  failed_projects: number;
}

export interface ImportDbResult {
  added: number;
  skipped: number;
  source_runs: number;
}
