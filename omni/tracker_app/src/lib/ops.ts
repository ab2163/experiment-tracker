import { omni, ACTIONS } from "../bridge"
import type { FolderKind, FolderRow, RunSetRow, CommandRow, ExperimentRow, StageRow, TrackerData } from "./data"
import { descendantIds } from "./folders"
import { genShortId } from "./shortId"

type Mutate = (fn: (d: TrackerData) => TrackerData) => void
interface ActionNode {
  id: string
}
const nowIso = () => new Date().toISOString()
// Stage.node_date is a datetime field — a bare "YYYY-MM-DD" is rejected, so pad it.
const dateToIso = (d: string): string | null => (d ? `${d}T00:00:00` : null)

// ---- stages + flow links ----------------------------------------------------
export interface StageFields {
  one_liner: string
  node_date: string // "YYYY-MM-DD" or ""
  result: string | null
}

export async function createStage(experimentId: string, f: StageFields, mutate: Mutate) {
  const created = (await omni.action(ACTIONS.createStage, {
    title: f.one_liner,
    properties: {
      one_liner: f.one_liner,
      node_date: dateToIso(f.node_date),
      result: f.result,
      experiment_id: experimentId,
      flows_to: [],
      run_ids: [],
    },
  })) as ActionNode
  const row: StageRow = {
    id: created.id,
    title: f.one_liner,
    node_date: f.node_date,
    result: f.result,
    experiment_id: experimentId,
    flows_to: [],
    run_ids: [],
    run_count: 0,
    run_set_ids: [],
    command_ids: [],
    pos_x: null,
    pos_y: null,
  }
  mutate((d) => ({ ...d, stages: [...d.stages, row] }))
}

// Attach/detach run sets + saved commands to a stage (stored as id-array
// properties on the Stage node, so the page can edit them without edges).
const setStageIds = async (id: string, key: "run_set_ids" | "command_ids", ids: string[], mutate: Mutate) => {
  await omni.action(ACTIONS.updateNode, { node_id: id, properties: { [key]: ids } })
  mutate((d) => ({ ...d, stages: d.stages.map((st) => (st.id === id ? { ...st, [key]: ids } : st)) }))
}
export async function attachRunSetToStage(stageId: string, runSetId: string, current: TrackerData, mutate: Mutate) {
  const st = current.stages.find((s) => s.id === stageId)
  if (!st || st.run_set_ids.includes(runSetId)) return
  await setStageIds(stageId, "run_set_ids", [...st.run_set_ids, runSetId], mutate)
}
export async function detachRunSetFromStage(stageId: string, runSetId: string, current: TrackerData, mutate: Mutate) {
  const st = current.stages.find((s) => s.id === stageId)
  if (!st) return
  await setStageIds(stageId, "run_set_ids", st.run_set_ids.filter((x) => x !== runSetId), mutate)
}
export async function attachCommandToStage(stageId: string, commandId: string, current: TrackerData, mutate: Mutate) {
  const st = current.stages.find((s) => s.id === stageId)
  if (!st || st.command_ids.includes(commandId)) return
  await setStageIds(stageId, "command_ids", [...st.command_ids, commandId], mutate)
}
export async function detachCommandFromStage(stageId: string, commandId: string, current: TrackerData, mutate: Mutate) {
  const st = current.stages.find((s) => s.id === stageId)
  if (!st) return
  await setStageIds(stageId, "command_ids", st.command_ids.filter((x) => x !== commandId), mutate)
}

/** Persist a stage's graph position (fire-and-forget; local state updated too). */
export async function savePosition(id: string, x: number, y: number, mutate: Mutate) {
  mutate((d) => ({ ...d, stages: d.stages.map((st) => (st.id === id ? { ...st, pos_x: x, pos_y: y } : st)) }))
  await omni.action(ACTIONS.updateNode, { node_id: id, properties: { pos_x: x, pos_y: y } })
}

export async function updateStage(id: string, f: StageFields, mutate: Mutate) {
  await omni.action(ACTIONS.updateNode, {
    node_id: id,
    title: f.one_liner,
    properties: { one_liner: f.one_liner, node_date: dateToIso(f.node_date), result: f.result },
  })
  mutate((d) => ({
    ...d,
    stages: d.stages.map((st) =>
      st.id === id ? { ...st, title: f.one_liner, node_date: f.node_date, result: f.result } : st,
    ),
  }))
}

/** Delete a stage node and strip it from every other stage's flows_to. */
export async function deleteStage(id: string, current: TrackerData, mutate: Mutate) {
  const inbound = current.stages.filter((st) => st.id !== id && st.flows_to.includes(id))
  for (const st of inbound) {
    const next = st.flows_to.filter((t) => t !== id)
    await omni.action(ACTIONS.updateNode, { node_id: st.id, properties: { flows_to: next } })
  }
  await omni.action(ACTIONS.deleteNode, { node_id: id })
  mutate((d) => ({
    ...d,
    stages: d.stages
      .filter((st) => st.id !== id)
      .map((st) => (st.flows_to.includes(id) ? { ...st, flows_to: st.flows_to.filter((t) => t !== id) } : st)),
  }))
}

const setFlows = async (id: string, flows: string[], mutate: Mutate) => {
  await omni.action(ACTIONS.updateNode, { node_id: id, properties: { flows_to: flows } })
  mutate((d) => ({ ...d, stages: d.stages.map((st) => (st.id === id ? { ...st, flows_to: flows } : st)) }))
}

export async function addLink(srcId: string, tgtId: string, current: TrackerData, mutate: Mutate) {
  const src = current.stages.find((st) => st.id === srcId)
  if (!src || src.flows_to.includes(tgtId)) return
  await setFlows(srcId, [...src.flows_to, tgtId], mutate)
}

export async function deleteLink(srcId: string, tgtId: string, current: TrackerData, mutate: Mutate) {
  const src = current.stages.find((st) => st.id === srcId)
  if (!src) return
  await setFlows(srcId, src.flows_to.filter((t) => t !== tgtId), mutate)
}

export async function reverseLink(srcId: string, tgtId: string, current: TrackerData, mutate: Mutate) {
  const src = current.stages.find((st) => st.id === srcId)
  const tgt = current.stages.find((st) => st.id === tgtId)
  if (!src || !tgt) return
  await setFlows(srcId, src.flows_to.filter((t) => t !== tgtId), mutate)
  if (!tgt.flows_to.includes(srcId)) await setFlows(tgtId, [...tgt.flows_to, srcId], mutate)
}

// ---- folders ----------------------------------------------------------------
export async function createFolder(name: string, kind: FolderKind, parentId: string | null, mutate: Mutate) {
  const created = (await omni.action(ACTIONS.createFolder, {
    title: name,
    properties: { name, kind, parent_folder_id: parentId, folder_created_at: nowIso() },
  })) as ActionNode
  const row: FolderRow = { id: created.id, name, kind, parent_id: parentId, created_by: null }
  mutate((d) => ({ ...d, folders: [...d.folders, row] }))
}

export async function renameFolder(id: string, name: string, mutate: Mutate) {
  await omni.action(ACTIONS.updateNode, { node_id: id, title: name, properties: { name } })
  mutate((d) => ({ ...d, folders: d.folders.map((f) => (f.id === id ? { ...f, name } : f)) }))
}

export async function moveFolder(id: string, dest: string | null, mutate: Mutate) {
  await omni.action(ACTIONS.updateNode, { node_id: id, properties: { parent_folder_id: dest } })
  mutate((d) => ({ ...d, folders: d.folders.map((f) => (f.id === id ? { ...f, parent_id: dest } : f)) }))
}

/** Delete a folder + all subfolders + the items they contain (cascade). */
export async function deleteFolderCascade(id: string, kind: FolderKind, current: TrackerData, mutate: Mutate) {
  const delFolders = descendantIds(current.folders, id)
  const inDeleted = (fid: string | null) => !!fid && delFolders.has(fid)
  const items =
    kind === "run_set"
      ? current.runSets.filter((r) => inDeleted(r.folder_id))
      : kind === "command"
        ? current.commands.filter((c) => inDeleted(c.folder_id))
        : current.experiments.filter((e) => inDeleted(e.folder_id))
  for (const it of items) await omni.action(ACTIONS.deleteNode, { node_id: it.id })
  for (const fid of delFolders) await omni.action(ACTIONS.deleteNode, { node_id: fid })
  mutate((d) => ({
    ...d,
    folders: d.folders.filter((f) => !delFolders.has(f.id)),
    runSets: kind === "run_set" ? d.runSets.filter((r) => !inDeleted(r.folder_id)) : d.runSets,
    commands: kind === "command" ? d.commands.filter((c) => !inDeleted(c.folder_id)) : d.commands,
    experiments: kind === "experiment" ? d.experiments.filter((e) => !inDeleted(e.folder_id)) : d.experiments,
  }))
}

// ---- run sets ---------------------------------------------------------------
export async function deleteRunSet(id: string, mutate: Mutate) {
  await omni.action(ACTIONS.deleteNode, { node_id: id })
  mutate((d) => ({ ...d, runSets: d.runSets.filter((r) => r.id !== id) }))
}

export async function moveRunSet(id: string, dest: string | null, mutate: Mutate) {
  await omni.action(ACTIONS.updateNode, { node_id: id, properties: { folder_id: dest } })
  mutate((d) => ({ ...d, runSets: d.runSets.map((r) => (r.id === id ? { ...r, folder_id: dest } : r)) }))
}

export async function mergeRunSets(
  name: string,
  sources: RunSetRow[],
  folderId: string | null,
  existingShortIds: Set<string>,
  mutate: Mutate,
) {
  const union = Array.from(new Set(sources.flatMap((s) => s.runIds)))
  const short_id = genShortId(existingShortIds)
  const created = (await omni.action(ACTIONS.createRunSet, {
    title: name,
    properties: { name, short_id, rs_created_at: nowIso(), run_ids: union, folder_id: folderId, visibility: "private" },
  })) as ActionNode
  const row: RunSetRow = {
    id: created.id,
    name,
    short_id,
    created_at: nowIso(),
    runIds: union,
    run_count: union.length,
    folder_id: folderId,
    visibility: "private",
    created_by: null,
  }
  mutate((d) => ({ ...d, runSets: [...d.runSets, row] }))
}

// ---- commands ---------------------------------------------------------------
export async function createCommand(name: string, command: string, folderId: string | null, mutate: Mutate) {
  const created = (await omni.action(ACTIONS.createCommand, {
    title: name,
    properties: { name, command, folder_id: folderId, visibility: "private" },
  })) as ActionNode
  const row: CommandRow = { id: created.id, name, command, folder_id: folderId, visibility: "private", created_by: null }
  mutate((d) => ({ ...d, commands: [...d.commands, row] }))
}

export async function updateCommand(id: string, name: string, command: string, mutate: Mutate) {
  await omni.action(ACTIONS.updateNode, { node_id: id, title: name, properties: { name, command } })
  mutate((d) => ({ ...d, commands: d.commands.map((c) => (c.id === id ? { ...c, name, command } : c)) }))
}

export async function deleteCommand(id: string, mutate: Mutate) {
  await omni.action(ACTIONS.deleteNode, { node_id: id })
  mutate((d) => ({ ...d, commands: d.commands.filter((c) => c.id !== id) }))
}

export async function moveCommand(id: string, dest: string | null, mutate: Mutate) {
  await omni.action(ACTIONS.updateNode, { node_id: id, properties: { folder_id: dest } })
  mutate((d) => ({ ...d, commands: d.commands.map((c) => (c.id === id ? { ...c, folder_id: dest } : c)) }))
}

// ---- experiments ------------------------------------------------------------
export async function createExperiment(
  fields: { title: string; kind: string; description: string | null; ref_url: string | null },
  folderId: string | null,
  mutate: Mutate,
) {
  // `kind` is an enum — the graph rejects an explicit null, so omit it when empty.
  const created = (await omni.action(ACTIONS.createExperiment, {
    title: fields.title,
    properties: {
      ...(fields.kind ? { kind: fields.kind } : {}),
      description: fields.description,
      ref_url: fields.ref_url,
      experiment_created_at: nowIso(),
      folder_id: folderId,
      visibility: "private",
    },
  })) as ActionNode
  const row: ExperimentRow = {
    id: created.id,
    title: fields.title,
    kind: fields.kind,
    description: fields.description,
    ref_url: fields.ref_url,
    created_at: nowIso(),
    node_count: 0,
    folder_id: folderId,
    visibility: "private",
    created_by: null,
  }
  mutate((d) => ({ ...d, experiments: [...d.experiments, row] }))
}

export async function moveExperiment(id: string, dest: string | null, mutate: Mutate) {
  await omni.action(ACTIONS.updateNode, { node_id: id, properties: { folder_id: dest } })
  mutate((d) => ({ ...d, experiments: d.experiments.map((e) => (e.id === id ? { ...e, folder_id: dest } : e)) }))
}

// ---- sharing (visibility) ---------------------------------------------------
type ShareKind = "experiment" | "run_set" | "command"
export async function setVisibility(kind: ShareKind, id: string, vis: "private" | "public", mutate: Mutate) {
  await omni.action(ACTIONS.updateNode, { node_id: id, properties: { visibility: vis } })
  mutate((d) => {
    if (kind === "experiment") return { ...d, experiments: d.experiments.map((e) => (e.id === id ? { ...e, visibility: vis } : e)) }
    if (kind === "run_set") return { ...d, runSets: d.runSets.map((r) => (r.id === id ? { ...r, visibility: vis } : r)) }
    return { ...d, commands: d.commands.map((c) => (c.id === id ? { ...c, visibility: vis } : c)) }
  })
}

export async function updateExperiment(
  id: string,
  fields: { title: string; kind: string; description: string | null; ref_url: string | null },
  mutate: Mutate,
) {
  await omni.action(ACTIONS.updateNode, {
    node_id: id,
    title: fields.title,
    properties: { ...(fields.kind ? { kind: fields.kind } : {}), description: fields.description, ref_url: fields.ref_url },
  })
  mutate((d) => ({
    ...d,
    experiments: d.experiments.map((e) =>
      e.id === id ? { ...e, title: fields.title, kind: fields.kind, description: fields.description, ref_url: fields.ref_url } : e,
    ),
  }))
}

export async function deleteExperiment(id: string, mutate: Mutate) {
  await omni.action(ACTIONS.deleteNode, { node_id: id })
  mutate((d) => ({ ...d, experiments: d.experiments.filter((e) => e.id !== id) }))
}
