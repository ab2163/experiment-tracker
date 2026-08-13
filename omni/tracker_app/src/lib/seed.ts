import { omni, ACTIONS } from "../bridge"
import type { Templates } from "./data"
import { genShortId } from "./shortId"

interface ActionNode {
  id: string
}
const nowIso = () => new Date().toISOString()
const dateToIso = (d: string): string | null => (d ? `${d}T00:00:00` : null)

/**
 * Clone the canonical "Example" template artifacts into brand-new nodes owned by
 * the current viewer (Omni stamps created_by from the session on every create),
 * so a new user lands with an editable example experiment + its run sets and
 * commands. All cross-references (stage flows, attached run sets/commands, folder
 * membership) are remapped from template ids to the freshly-created ids. The
 * copies drop the is_template flag, so they behave as ordinary user items.
 */
export async function seedExamples(templates: Templates, existingShortIds: Set<string>): Promise<void> {
  const create = async (action: string, title: string, properties: Record<string, unknown>) =>
    ((await omni.action(action, { title, properties })) as ActionNode).id

  // folders (both example folders are at root)
  const folderMap = new Map<string, string>()
  for (const f of templates.folders) {
    const id = await create(ACTIONS.createFolder, f.name, {
      name: f.name,
      kind: f.kind,
      parent_folder_id: null,
      folder_created_at: nowIso(),
    })
    folderMap.set(f.id, id)
  }

  // run sets (fresh unique short ids; membership preserved)
  const shorts = new Set(existingShortIds)
  const rsMap = new Map<string, string>()
  for (const r of templates.runSets) {
    const short_id = genShortId(shorts)
    shorts.add(short_id)
    const id = await create(ACTIONS.createRunSet, r.name, {
      name: r.name,
      short_id,
      rs_created_at: nowIso(),
      run_ids: r.runIds,
      folder_id: r.folder_id ? folderMap.get(r.folder_id) ?? null : null,
      visibility: "private",
    })
    rsMap.set(r.id, id)
  }

  // commands
  const cmdMap = new Map<string, string>()
  for (const c of templates.commands) {
    const id = await create(ACTIONS.createCommand, c.name, {
      name: c.name,
      command: c.command,
      folder_id: c.folder_id ? folderMap.get(c.folder_id) ?? null : null,
      visibility: "private",
    })
    cmdMap.set(c.id, id)
  }

  // experiment(s) at root
  const expMap = new Map<string, string>()
  for (const e of templates.experiments) {
    const id = await create(ACTIONS.createExperiment, e.title, {
      ...(e.kind ? { kind: e.kind } : {}),
      description: e.description,
      ref_url: e.ref_url,
      experiment_created_at: nowIso(),
      folder_id: null,
      visibility: "private",
    })
    expMap.set(e.id, id)
  }

  // stages (create with membership; links remapped in a second pass once all ids exist)
  const stageMap = new Map<string, string>()
  for (const st of templates.stages) {
    const id = await create(ACTIONS.createStage, st.title, {
      one_liner: st.title,
      node_date: dateToIso(st.node_date),
      result: st.result,
      experiment_id: st.experiment_id ? expMap.get(st.experiment_id) ?? null : null,
      flows_to: [],
      run_ids: st.run_ids,
      run_set_ids: [],
      command_ids: [],
    })
    stageMap.set(st.id, id)
  }
  for (const st of templates.stages) {
    const nid = stageMap.get(st.id)
    if (!nid) continue
    const remap = (ids: string[], m: Map<string, string>) => ids.map((x) => m.get(x)).filter((x): x is string => !!x)
    await omni.action(ACTIONS.updateNode, {
      node_id: nid,
      properties: {
        flows_to: remap(st.flows_to, stageMap),
        run_set_ids: remap(st.run_set_ids, rsMap),
        command_ids: remap(st.command_ids, cmdMap),
      },
    })
  }
}
