import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { omni, SOURCES } from "../bridge"

// ---- raw graph shapes off the bridge ----------------------------------------
interface RawNode {
  id: string
  title?: string
  type?: string
  created_by?: string
  createdBy?: string
  properties?: Record<string, unknown>
}
interface RawEdge {
  from_node_id?: string
  to_node_id?: string
  type?: string
}
interface PagedResult<T> {
  items: T[]
  next_cursor?: string | null
}

// Drain a bounded source (200/page cap) by looping next_cursor.
async function drain<T>(name: string): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null | undefined
  for (let i = 0; i < 500; i++) {
    const params: Record<string, unknown> = { limit: 200 }
    if (cursor) params.cursor = cursor
    const res = (await omni.query(name, params)) as PagedResult<T>
    const items = res?.items ?? []
    out.push(...items)
    cursor = res?.next_cursor
    if (!cursor || items.length === 0) break
  }
  return out
}

const s = (v: unknown): string => (v == null ? "" : String(v))
const n = (v: unknown): number | null => (v == null || v === "" ? null : Number(v))
// The server-set creator of a node (email or user id). Used for ownership badges
// and client-side "mine vs shared" filtering (a cosmetic affordance, not auth).
const owner = (x: RawNode): string | null => x.created_by ?? x.createdBy ?? null
export type Visibility = "private" | "public"
const visOf = (p: Record<string, unknown>): Visibility => (s(p.visibility) === "public" ? "public" : "private")

// ---- normalized domain models -----------------------------------------------
export interface RunRow {
  id: string
  display_name: string
  project: string
  url: string
  user: string | null
  state: string | null
  created_at: string
  commit: string | null
  environment: string
  batch_size: number | null
  group_size: number | null
  hyperparameters: Record<string, unknown>
}
export interface ExperimentRow {
  id: string
  title: string
  kind: string
  description: string | null
  ref_url: string | null
  created_at: string
  node_count: number
  folder_id: string | null
  visibility: Visibility
  created_by: string | null
}
export interface StageRow {
  id: string
  title: string
  node_date: string
  result: string | null
  experiment_id: string | null
  flows_to: string[]
  run_ids: string[]
  run_count: number
  run_set_ids: string[]
  command_ids: string[]
  pos_x: number | null
  pos_y: number | null
}
export interface RunSetRow {
  id: string
  name: string
  short_id: string | null
  created_at: string
  runIds: string[]
  run_count: number
  folder_id: string | null
  visibility: Visibility
  created_by: string | null
}
export interface CommandRow {
  id: string
  name: string
  command: string
  folder_id: string | null
  visibility: Visibility
  created_by: string | null
}
export type FolderKind = "run_set" | "command" | "experiment"
export interface FolderRow {
  id: string
  name: string
  kind: FolderKind
  parent_id: string | null
  created_by: string | null
}
export interface ImprovementRow {
  id: string
  number: number
  title: string
  description: string | null
  priority: "H" | "M" | "L" | null
  resolution: "unresolved" | "resolved"
}

// Canonical "Example" artifacts (is_template flagged). Hidden from every normal
// view; used only as the source the onboarding seeder clones into a new user.
export interface Templates {
  experiments: ExperimentRow[]
  stages: StageRow[]
  runSets: RunSetRow[]
  commands: CommandRow[]
  folders: FolderRow[]
}

export interface TrackerData {
  runs: RunRow[]
  runsById: Map<string, RunRow>
  experiments: ExperimentRow[]
  stages: StageRow[]
  runSets: RunSetRow[]
  commands: CommandRow[]
  improvements: ImprovementRow[]
  folders: FolderRow[]
  templates: Templates
}

const Ctx = createContext<{
  data: TrackerData | null
  loading: boolean
  error: string | null
  reload: () => void
  upsertImprovementLocal: (row: ImprovementRow) => void
  removeImprovementLocal: (id: string) => void
  addRunSetLocal: (row: RunSetRow) => void
  mutate: (fn: (d: TrackerData) => TrackerData) => void
}>({
  data: null,
  loading: true,
  error: null,
  reload: () => {},
  upsertImprovementLocal: () => {},
  removeImprovementLocal: () => {},
  addRunSetLocal: () => {},
  mutate: () => {},
})

export const useTracker = () => useContext(Ctx)

export function TrackerDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TrackerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const [runsRaw, expsRaw, stagesRaw, setsRaw, cmdsRaw, setRunsRaw, impsRaw, foldersRaw] = await Promise.all([
          drain<RawNode>(SOURCES.runs),
          drain<RawNode>(SOURCES.experiments),
          drain<RawNode>(SOURCES.stages),
          drain<RawNode>(SOURCES.runSets),
          drain<RawNode>(SOURCES.commands),
          drain<RawEdge>(SOURCES.runSetRuns),
          drain<RawNode>(SOURCES.improvements),
          drain<RawNode>(SOURCES.folders),
        ])
        if (cancelled) return

        // defensive type filtering
        const runNodes = runsRaw.filter((x) => !x.type || x.type === "Run")
        const expNodes = expsRaw.filter((x) => !x.type || x.type === "Experiment")
        const setNodes = setsRaw.filter((x) => !x.type || x.type === "RunSet")
        const cmdNodes = cmdsRaw.filter((x) => !x.type || x.type === "SavedCommand")
        const stageNodes = stagesRaw.filter((x) => !x.type || x.type === "Stage")
        const setRuns = setRunsRaw.filter((e) => !e.type || e.type === "RUN_SET_HAS_RUN")

        // Stage structure lives on the node itself (experiment_id + flows_to +
        // run_ids properties), not edges — the page bridge can't create edges,
        // so the flow graph is fully page-editable this way.
        const asStrArray = (v: unknown): string[] =>
          Array.isArray(v) ? (v as unknown[]).map(String) : []
        const stages: StageRow[] = stageNodes.map((x) => {
          const p = x.properties ?? {}
          return {
            id: x.id,
            title: s(p.one_liner) || x.title || x.id,
            node_date: p.node_date ? s(p.node_date).slice(0, 10) : "",
            result: p.result ? s(p.result) : null,
            experiment_id: p.experiment_id ? s(p.experiment_id) : null,
            flows_to: asStrArray(p.flows_to),
            run_ids: asStrArray(p.run_ids),
            run_count: asStrArray(p.run_ids).length,
            run_set_ids: asStrArray(p.run_set_ids),
            command_ids: asStrArray(p.command_ids),
            pos_x: n(p.pos_x),
            pos_y: n(p.pos_y),
          }
        })
        const stageCountByExp = new Map<string, number>()
        stages.forEach((st) => {
          if (st.experiment_id) stageCountByExp.set(st.experiment_id, (stageCountByExp.get(st.experiment_id) ?? 0) + 1)
        })

        const runs: RunRow[] = runNodes.map((x) => {
          const p = x.properties ?? {}
          let hp: Record<string, unknown> = {}
          const rawHp = p.hyperparameters
          if (rawHp && typeof rawHp === "object") hp = rawHp as Record<string, unknown>
          else if (typeof rawHp === "string" && rawHp) {
            try { hp = JSON.parse(rawHp) } catch { hp = {} }
          }
          return {
            id: x.id,
            display_name: s(p.display_name) || x.title || x.id,
            project: s(p.project),
            url: s(p.url),
            user: p.user ? s(p.user) : null,
            state: p.state ? s(p.state) : null,
            created_at: s(p.run_created_at),
            commit: p.commit ? s(p.commit) : null,
            environment: s(p.environment),
            batch_size: n(p.batch_size),
            group_size: n(p.group_size),
            hyperparameters: hp,
          }
        })
        const runsById = new Map(runs.map((r) => [r.id, r]))

        const experiments: ExperimentRow[] = expNodes.map((x) => {
          const p = x.properties ?? {}
          return {
            id: x.id,
            title: x.title || s(p.title) || x.id,
            kind: s(p.kind),
            description: p.description ? s(p.description) : null,
            ref_url: p.ref_url ? s(p.ref_url) : null,
            created_at: s(p.experiment_created_at),
            node_count: stageCountByExp.get(x.id) ?? 0,
            folder_id: p.folder_id ? s(p.folder_id) : null,
            visibility: visOf(p),
            created_by: owner(x),
          }
        })

        // runs per run set via RUN_SET_HAS_RUN
        const setRunIds = new Map<string, string[]>()
        setRuns.forEach((e) => {
          const rs = e.from_node_id
          const run = e.to_node_id
          if (rs && run) {
            const arr = setRunIds.get(rs) ?? []
            arr.push(run)
            setRunIds.set(rs, arr)
          }
        })
        const runSets: RunSetRow[] = setNodes.map((x) => {
          const p = x.properties ?? {}
          // New run sets (created in-page) store membership as a run_ids json
          // array; imported ones use RUN_SET_HAS_RUN edges. Prefer the property.
          const propIds = Array.isArray(p.run_ids) ? (p.run_ids as unknown[]).map(String) : null
          const ids = propIds ?? setRunIds.get(x.id) ?? []
          return {
            id: x.id,
            name: s(p.name) || x.title || x.id,
            short_id: p.short_id ? s(p.short_id) : null,
            created_at: s(p.rs_created_at),
            runIds: ids,
            run_count: ids.length,
            folder_id: p.folder_id ? s(p.folder_id) : null,
            visibility: visOf(p),
            created_by: owner(x),
          }
        })

        const commands: CommandRow[] = cmdNodes.map((x) => {
          const p = x.properties ?? {}
          return {
            id: x.id,
            name: s(p.name) || x.title || x.id,
            command: s(p.command),
            folder_id: p.folder_id ? s(p.folder_id) : null,
            visibility: visOf(p),
            created_by: owner(x),
          }
        })

        const folderNodes = foldersRaw.filter((x) => !x.type || x.type === "Folder")
        const folders: FolderRow[] = folderNodes.map((x) => {
          const p = x.properties ?? {}
          const k = s(p.kind)
          return {
            id: x.id,
            name: s(p.name) || x.title || x.id,
            kind: k === "command" || k === "experiment" ? k : "run_set",
            parent_id: p.parent_folder_id ? s(p.parent_folder_id) : null,
            created_by: owner(x),
          }
        })

        const impNodes = impsRaw.filter((x) => !x.type || x.type === "Improvement")
        const improvements: ImprovementRow[] = impNodes.map((x) => {
          const p = x.properties ?? {}
          const pri = s(p.priority)
          const res = s(p.resolution)
          return {
            id: x.id,
            number: n(p.number) ?? 0,
            title: x.title || x.id,
            description: p.description ? s(p.description) : null,
            priority: pri === "H" || pri === "M" || pri === "L" ? pri : null,
            resolution: res === "resolved" ? "resolved" : "unresolved",
          }
        })

        // Split off is_template-flagged "Example" artifacts so they never appear
        // in any user's tree/shared view; they're only the seeder's clone source.
        const isTpl = (x: RawNode) => s(x.properties?.is_template) === "1"
        const tExpIds = new Set(expNodes.filter(isTpl).map((x) => x.id))
        const tRsIds = new Set(setNodes.filter(isTpl).map((x) => x.id))
        const tCmdIds = new Set(cmdNodes.filter(isTpl).map((x) => x.id))
        const tFolIds = new Set(folderNodes.filter(isTpl).map((x) => x.id))
        const templates: Templates = {
          experiments: experiments.filter((e) => tExpIds.has(e.id)),
          stages: stages.filter((st) => st.experiment_id && tExpIds.has(st.experiment_id)),
          runSets: runSets.filter((r) => tRsIds.has(r.id)),
          commands: commands.filter((c) => tCmdIds.has(c.id)),
          folders: folders.filter((f) => tFolIds.has(f.id)),
        }
        setData({
          runs,
          runsById,
          experiments: experiments.filter((e) => !tExpIds.has(e.id)),
          stages: stages.filter((st) => !(st.experiment_id && tExpIds.has(st.experiment_id))),
          runSets: runSets.filter((r) => !tRsIds.has(r.id)),
          commands: commands.filter((c) => !tCmdIds.has(c.id)),
          improvements,
          folders: folders.filter((f) => !tFolIds.has(f.id)),
          templates,
        })
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tick])

  const upsertImprovementLocal = (row: ImprovementRow) =>
    setData((prev) => {
      if (!prev) return prev
      const rest = prev.improvements.filter((i) => i.id !== row.id)
      return { ...prev, improvements: [...rest, row] }
    })
  const removeImprovementLocal = (id: string) =>
    setData((prev) => (prev ? { ...prev, improvements: prev.improvements.filter((i) => i.id !== id) } : prev))
  const addRunSetLocal = (row: RunSetRow) =>
    setData((prev) => (prev ? { ...prev, runSets: [...prev.runSets, row] } : prev))
  const mutate = (fn: (d: TrackerData) => TrackerData) => setData((prev) => (prev ? fn(prev) : prev))

  return (
    <Ctx.Provider
      value={{ data, loading, error, reload: () => setTick((t) => t + 1), upsertImprovementLocal, removeImprovementLocal, addRunSetLocal, mutate }}
    >
      {children}
    </Ctx.Provider>
  )
}
