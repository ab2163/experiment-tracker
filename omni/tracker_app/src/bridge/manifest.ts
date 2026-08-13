/**
 * Typed handles for the sources declared in `omni-page.json`.
 * The bridge rejects any source key not declared there (and any schemaId not in
 * the page's linked schemas). Read-only app — no actions declared.
 */
export const SOURCES = {
  runs: "runs",
  experiments: "experiments",
  stages: "stages",
  runSets: "runSets",
  commands: "commands",
  runSetRuns: "runSetRuns",
  improvements: "improvements",
  folders: "folders",
} as const

export type SourceKey = (typeof SOURCES)[keyof typeof SOURCES]

export const ACTIONS = {
  createRunSet: "createRunSet",
  createCommand: "createCommand",
  createFolder: "createFolder",
  createExperiment: "createExperiment",
  createStage: "createStage",
  updateNode: "updateNode",
  deleteNode: "deleteNode",
  createImprovement: "createImprovement",
  updateImprovement: "updateImprovement",
  deleteImprovement: "deleteImprovement",
} as const

export type ActionKey = (typeof ACTIONS)[keyof typeof ACTIONS]
