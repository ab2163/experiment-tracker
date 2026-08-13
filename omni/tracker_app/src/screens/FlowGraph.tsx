import { useMemo, useState, useCallback, useEffect } from "react"
import {
  Box, Group, Text, Title, Stack, Badge, CloseButton, Paper, Button, Modal,
  TextInput, Menu, Anchor,
} from "@mantine/core"
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import Dagre from "@dagrejs/dagre"
import { EmptyState } from "@shared/omni-ui"
import { useOmniColorScheme } from "../bridge"
import { useTracker, type StageRow } from "../lib/data"
import { useConfirm } from "../lib/confirm"
import { LinkIcon, ReverseIcon, ArrowLeft } from "../lib/icons"
import { RichText, LinkTextarea } from "../lib/richtext"
import {
  createStage, updateStage, deleteStage, addLink, deleteLink, reverseLink, savePosition,
  attachRunSetToStage, detachRunSetFromStage, attachCommandToStage, detachCommandFromStage,
  type StageFields,
} from "../lib/ops"

const NODE_W = 190
const NODE_H = 66

interface StageData extends Record<string, unknown> {
  label: string
  date: string
  runs: number
  hasResult: boolean
  linking: boolean
  runSets: string[] // short_ids
  commands: { id: string; name: string }[]
  onCommandClick?: (id: string) => void
}

const dotStyle = { width: 8, height: 8, background: "#fff", border: "1px solid #64748b" }

// Each side carries BOTH a source and a target handle (stacked into one visible
// dot). Which handle an edge uses is decided by geometry at render time, so a
// link can attach on either side and reversing it keeps the same physical sides.
function StageNode({ data, selected }: NodeProps) {
  const d = data as StageData
  return (
    <div
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        boxSizing: "border-box",
        borderRadius: 10,
        padding: "8px 10px",
        background: d.hasResult ? "#16a34a" : "#64748b",
        color: "#fff",
        border: d.linking
          ? "3px solid #f59e0b"
          : selected
            ? "3px solid #2563eb"
            : "1px solid rgba(0,0,0,.15)",
        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
        fontSize: 12,
        lineHeight: 1.25,
      }}
    >
      <Handle id="l-target" type="target" position={Position.Left} style={dotStyle} />
      <Handle id="l-source" type="source" position={Position.Left} style={dotStyle} />
      <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{d.label}</div>
      <div style={{ opacity: 0.85, marginTop: 3, fontSize: 11 }}>
        {d.date || "—"}
        {d.runs ? ` · ${d.runs} run${d.runs > 1 ? "s" : ""}` : ""}
      </div>
      {d.runSets.length > 0 && (
        <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>
          {d.runSets.map((sid) => (
            <span
              key={sid}
              title={`run set ${sid}`}
              style={{ fontSize: 10, fontFamily: "monospace", background: "#f59e0b", color: "#1f2937", borderRadius: 4, padding: "0 4px" }}
            >
              {sid}
            </span>
          ))}
        </div>
      )}
      {d.commands.length > 0 && (
        <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>
          {d.commands.map((c) => (
            <span
              key={c.id}
              className="nodrag"
              title={`open command: ${c.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); d.onCommandClick?.(c.id) }}
              style={{ fontSize: 10, background: "rgba(255,255,255,.25)", borderRadius: 4, padding: "0 4px", cursor: "pointer", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              ⌘ {c.name}
            </span>
          ))}
        </div>
      )}
      <Handle id="r-target" type="target" position={Position.Right} style={dotStyle} />
      <Handle id="r-source" type="source" position={Position.Right} style={dotStyle} />
    </div>
  )
}

const nodeTypes = { stage: StageNode }

// dagre LR positions (fallback for stages without a saved position).
function dagrePositions(ids: string[], pairs: [string, string][]): Map<string, { x: number; y: number }> {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 })
  ids.forEach((id) => g.setNode(id, { width: NODE_W, height: NODE_H }))
  pairs.forEach(([a, b]) => { if (ids.includes(a) && ids.includes(b)) g.setEdge(a, b) })
  Dagre.layout(g)
  const out = new Map<string, { x: number; y: number }>()
  ids.forEach((id) => {
    const p = g.node(id)
    out.set(id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 })
  })
  return out
}

export function FlowGraph({
  experimentId,
  experimentTitle,
  onBack,
  onOpenCommand,
}: {
  experimentId: string
  experimentTitle: string
  onBack: () => void
  onOpenCommand?: (id: string) => void
}) {
  const colorScheme = useOmniColorScheme()
  const { data, mutate } = useTracker()
  const confirm = useConfirm()
  const stages = data!.stages
  const commandName = useMemo(() => new Map(data!.commands.map((c) => [c.id, c.name])), [data])
  const runSetShort = useMemo(() => new Map(data!.runSets.map((r) => [r.id, r.short_id])), [data])
  const onCommandChipClick = useCallback((id: string) => onOpenCommand?.(id), [onOpenCommand])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<{ source: string; target: string } | null>(null)
  const [linkMode, setLinkMode] = useState(false)
  const [linkSource, setLinkSource] = useState<string | null>(null)
  const [editing, setEditing] = useState<StageRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const guard = (p: Promise<unknown>) => p.catch((e) => setErr(e instanceof Error ? e.message : String(e)))

  const mine = useMemo(() => stages.filter((st) => st.experiment_id === experimentId), [stages, experimentId])
  const stagesById = useMemo(() => new Map(stages.map((st) => [st.id, st])), [stages])

  // Reconcile React Flow nodes with the stage data, preserving current on-screen
  // positions (so a drag isn't lost). New/unpositioned stages fall back to the
  // saved pos_x/pos_y, else a dagre layout slot. Only depends on `mine`, so a
  // drag (which changes node positions, not `mine`) never rebuilds nodes.
  useEffect(() => {
    const ids = mine.map((st) => st.id)
    const idSet = new Set(ids)
    const pairs = mine.flatMap((st) => st.flows_to.filter((t) => idSet.has(t)).map((t) => [st.id, t] as [string, string]))
    const fallback = dagrePositions(ids, pairs)
    setNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]))
      return mine.map((st) => {
        const saved = st.pos_x != null && st.pos_y != null ? { x: st.pos_x, y: st.pos_y } : null
        const position = prevPos.get(st.id) ?? saved ?? fallback.get(st.id) ?? { x: 0, y: 0 }
        return {
          id: st.id,
          type: "stage",
          position,
          data: {
            label: st.title,
            date: st.node_date,
            runs: st.run_count,
            hasResult: !!st.result,
            linking: false,
            runSets: st.run_set_ids.map((id) => runSetShort.get(id)).filter((s): s is string => !!s),
            commands: st.command_ids.map((id) => ({ id, name: commandName.get(id) ?? "command" })),
            onCommandClick: onCommandChipClick,
          } satisfies StageData,
        }
      })
    })
  }, [mine, runSetShort, commandName, onCommandChipClick, setNodes])

  // Edges derive from flows_to; handle sides are chosen by geometry (which node
  // is physically left), so links render on the nearest faces and a reverse just
  // flips the arrowhead. Depends on node positions so it updates live on drag.
  const rfEdges = useMemo<Edge[]>(() => {
    const posById = new Map(nodes.map((n) => [n.id, n.position]))
    const visible = new Set(mine.map((st) => st.id))
    return mine.flatMap((st) =>
      st.flows_to
        .filter((t) => visible.has(t) && posById.has(t) && posById.has(st.id))
        .map((t) => {
          const sp = posById.get(st.id)!
          const dp = posById.get(t)!
          const leftToRight = sp.x + NODE_W < dp.x // origin RHS left of destination LHS
          return {
            id: `${st.id}__${t}`,
            source: st.id,
            target: t,
            sourceHandle: leftToRight ? "r-source" : "l-source",
            targetHandle: leftToRight ? "l-target" : "r-target",
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
            zIndex: 1000, // render arrows above nodes
          }
        }),
    )
  }, [nodes, mine])

  // Inject the "link source" highlight without rebuilding node positions.
  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, linking: n.id === linkSource } })),
    [nodes, linkSource],
  )

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (linkMode) {
        if (!linkSource) { setLinkSource(node.id); return }
        if (linkSource === node.id) { setLinkSource(null); return }
        guard(addLink(linkSource, node.id, data!, mutate))
        setLinkSource(null)
        return
      }
      setSelected(node.id)
      setSelectedEdge(null)
    },
    [linkMode, linkSource, data, mutate],
  )
  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setSelectedEdge({ source: edge.source, target: edge.target })
    setSelected(null)
  }, [])
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => { guard(savePosition(node.id, node.position.x, node.position.y, mutate)) },
    [mutate],
  )
  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) guard(addLink(c.source, c.target, data!, mutate))
    },
    [data, mutate],
  )
  const toggleLinkMode = () => {
    setLinkMode((m) => !m)
    setLinkSource(null)
    setSelected(null)
    setSelectedEdge(null)
  }

  const sel: StageRow | undefined = selected ? stagesById.get(selected) : undefined

  const submitStage = async (f: StageFields) => {
    if (editing) await guard(updateStage(editing.id, f, mutate))
    else await guard(createStage(experimentId, f, mutate))
    setCreating(false)
    setEditing(null)
  }

  return (
    <Stack gap={0} style={{ height: "100%", paddingBottom: 56, boxSizing: "border-box" }}>
      <Group px="md" py="sm" justify="space-between" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group gap="md" wrap="nowrap">
          <Button size="xs" variant="default" onClick={onBack} leftSection={<ArrowLeft size={14} />}>Back to experiments</Button>
          <Title order={4} lineClamp={1}>{experimentTitle}</Title>
        </Group>
        <Group gap="xs">
          <Button size="xs" onClick={() => { setCreating(true); setSelected(null); setSelectedEdge(null) }}>+ Add stage</Button>
          <Button
            size="xs"
            variant={linkMode ? "filled" : "default"}
            color={linkMode ? "orange" : undefined}
            onClick={toggleLinkMode}
            leftSection={<LinkIcon size={14} />}
          >
            {linkMode ? "Linking…" : "Link stages"}
          </Button>
          <Badge color="green" variant="filled">has result</Badge>
          <Badge color="gray" variant="filled">no result</Badge>
          <Text size="sm" c="dimmed">
            {nodes.length} stage{nodes.length === 1 ? "" : "s"}
          </Text>
        </Group>
      </Group>

      {err && <Text c="red" size="sm" px="md" py={4}>{err}</Text>}

      <Box style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {nodes.length === 0 ? (
          <EmptyState title="No stages yet" description="Use “+ Add stage” to create the first stage of this experiment." />
        ) : (
          <ReactFlow
            nodes={displayNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onConnect={onConnect}
            onPaneClick={() => { setSelected(null); setSelectedEdge(null); if (linkMode) setLinkSource(null) }}
            nodesDraggable={!linkMode}
            colorMode={colorScheme}
            fitView
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}

        {linkMode && (
          <Text size="xs" c="dimmed" style={{ position: "absolute", bottom: 8, left: 12, pointerEvents: "none" }}>
            {linkSource ? "Now click the destination stage." : "Click the origin stage."}
          </Text>
        )}

        {selectedEdge && (
          <Paper shadow="md" withBorder p="xs" style={{ position: "absolute", top: 12, left: 12 }}>
            <Group gap="xs">
              <Text size="xs" c="dimmed">Link:</Text>
              <Button
                size="xs"
                variant="default"
                leftSection={<ReverseIcon size={14} />}
                onClick={() => { guard(reverseLink(selectedEdge.source, selectedEdge.target, data!, mutate)); setSelectedEdge(null) }}
              >
                Reverse
              </Button>
              <Button
                size="xs"
                variant="light"
                color="red"
                onClick={() => { guard(deleteLink(selectedEdge.source, selectedEdge.target, data!, mutate)); setSelectedEdge(null) }}
              >
                Delete link
              </Button>
            </Group>
          </Paper>
        )}

        {sel && (
          <Paper
            shadow="md"
            withBorder
            p="md"
            style={{ position: "absolute", top: 12, right: 12, width: 300, maxHeight: "calc(100% - 24px)", overflow: "auto" }}
          >
            <Group justify="space-between" mb="xs" wrap="nowrap">
              <Text fw={600}>{sel.title}</Text>
              <CloseButton onClick={() => setSelected(null)} />
            </Group>
            <Stack gap={8}>
              <Field label="Date" value={sel.node_date || "—"} />
              <Field label="Runs" value={String(sel.run_count)} />
              <Field label="Result" value={sel.result || "—"} rich={!!sel.result} />
              <AttachList
                label="Run sets"
                attachedIds={sel.run_set_ids}
                options={data!.runSets.map((r) => ({ id: r.id, name: r.name }))}
                onAdd={(id) => guard(attachRunSetToStage(sel.id, id, data!, mutate))}
                onRemove={(id) => guard(detachRunSetFromStage(sel.id, id, data!, mutate))}
              />
              <AttachList
                label="Commands"
                attachedIds={sel.command_ids}
                options={data!.commands.map((c) => ({ id: c.id, name: c.name }))}
                onAdd={(id) => guard(attachCommandToStage(sel.id, id, data!, mutate))}
                onRemove={(id) => guard(detachCommandFromStage(sel.id, id, data!, mutate))}
              />
            </Stack>
            <Group mt="md" gap="xs">
              <Button size="xs" variant="default" onClick={() => { setEditing(sel); setSelected(null) }}>Edit</Button>
              <Button
                size="xs"
                variant="light"
                color="red"
                onClick={async () => {
                  const st = sel
                  setSelected(null)
                  if (await confirm({ title: "Delete stage", message: `Delete stage “${st.title}”? Links to and from it are also removed.` }))
                    guard(deleteStage(st.id, data!, mutate))
                }}
              >
                Delete
              </Button>
            </Group>
          </Paper>
        )}
      </Box>

      {(creating || editing) && (
        <StageForm
          initial={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSubmit={submitStage}
        />
      )}
    </Stack>
  )
}

function StageForm({
  initial,
  onClose,
  onSubmit,
}: {
  initial?: StageRow
  onClose: () => void
  onSubmit: (f: StageFields) => Promise<void>
}) {
  const [oneLiner, setOneLiner] = useState(initial?.title ?? "")
  const [date, setDate] = useState(initial?.node_date ?? "")
  const [result, setResult] = useState(initial?.result ?? "")
  const [busy, setBusy] = useState(false)
  const [e, setE] = useState<string | null>(null)

  const submit = async () => {
    if (!oneLiner.trim()) { setE("A summary is required."); return }
    setBusy(true)
    try {
      await onSubmit({ one_liner: oneLiner.trim(), node_date: date, result: result.trim() || null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened onClose={onClose} title={initial ? "Edit stage" : "New stage"} centered>
      <Stack gap="sm">
        <TextInput label="Summary" required value={oneLiner} onChange={(ev) => setOneLiner(ev.currentTarget.value)} data-autofocus />
        <TextInput label="Date" type="date" value={date} onChange={(ev) => setDate(ev.currentTarget.value)} />
        <LinkTextarea label="Result (optional)" autosize minRows={2} value={result} onChange={setResult} description="Select text and press ⌘K / Ctrl+K to insert a link." />
        {e && <Text c="red" size="sm">{e}</Text>}
        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>Cancel</Button>
          <Button size="xs" onClick={submit} loading={busy}>{initial ? "Save" : "Create"}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function AttachList({
  label,
  attachedIds,
  options,
  onAdd,
  onRemove,
}: {
  label: string
  attachedIds: string[]
  options: { id: string; name: string }[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}) {
  const nameById = new Map(options.map((o) => [o.id, o.name]))
  const available = options.filter((o) => !attachedIds.includes(o.id))
  return (
    <div>
      <Group justify="space-between" mb={2}>
        <Text size="xs" c="dimmed" tt="uppercase">{label}</Text>
        <Menu withinPortal position="bottom-end" shadow="md">
          <Menu.Target><Anchor size="xs">+ add</Anchor></Menu.Target>
          <Menu.Dropdown mah={240} style={{ overflowY: "auto" }}>
            {available.length === 0 ? (
              <Menu.Item disabled>None available</Menu.Item>
            ) : (
              available.map((o) => (
                <Menu.Item key={o.id} onClick={() => onAdd(o.id)}>{o.name}</Menu.Item>
              ))
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
      {attachedIds.length === 0 ? (
        <Text size="xs" c="dimmed">—</Text>
      ) : (
        <Group gap={4}>
          {attachedIds.map((id) => (
            <Badge
              key={id}
              size="sm"
              variant="light"
              rightSection={
                <Text component="span" style={{ cursor: "pointer" }} onClick={() => onRemove(id)}>×</Text>
              }
            >
              {nameById.get(id) ?? "unknown"}
            </Badge>
          ))}
        </Group>
      )}
    </div>
  )
}

function Field({ label, value, rich }: { label: string; value: string; rich?: boolean }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase">{label}</Text>
      <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {rich ? <RichText text={value} /> : value}
      </Text>
    </div>
  )
}
