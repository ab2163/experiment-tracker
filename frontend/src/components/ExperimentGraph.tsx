import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  addCommandsToNode,
  addRunsToNode,
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  fetchGraph,
  fetchRunSets,
  fetchSavedCommands,
  removeCommandFromNode,
  removeRunFromNode,
  setNodePosition,
  setNodeRunSet,
  updateNode,
} from "../api";
import type { Graph, GraphNode, RunSet, SavedCommand } from "../types";
import { noAssist } from "../uiHelpers";
import RunPicker from "./RunPicker";

const EDGE_COLOR = "#111827";

/** Simple left-to-right layered layout by edge depth, used only when a node has
    no persisted position yet. */
function layout(nodes: GraphNode[], edges: Graph["edges"]): Record<string, { x: number; y: number }> {
  const incoming = new Map<string, number>();
  nodes.forEach((n) => incoming.set(n.id, 0));
  edges.forEach((e) => incoming.set(e.target_id, (incoming.get(e.target_id) ?? 0) + 1));

  const depth = new Map<string, number>();
  const queue = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  queue.forEach((id) => depth.set(id, 0));
  const remaining = new Map(incoming);
  while (queue.length) {
    const id = queue.shift()!;
    edges
      .filter((e) => e.source_id === id)
      .forEach((e) => {
        depth.set(e.target_id, Math.max(depth.get(e.target_id) ?? 0, (depth.get(id) ?? 0) + 1));
        remaining.set(e.target_id, (remaining.get(e.target_id) ?? 1) - 1);
        if ((remaining.get(e.target_id) ?? 0) <= 0) queue.push(e.target_id);
      });
  }

  const rowByDepth = new Map<number, number>();
  const pos: Record<string, { x: number; y: number }> = {};
  // Stable order: by node_date then created_at.
  [...nodes]
    .sort((a, b) => (a.node_date + a.created_at).localeCompare(b.node_date + b.created_at))
    .forEach((n) => {
      const d = depth.get(n.id) ?? 0;
      const row = rowByDepth.get(d) ?? 0;
      rowByDepth.set(d, row + 1);
      pos[n.id] = { x: d * 300, y: row * 170 };
    });
  return pos;
}

function AblationNode({
  data,
}: NodeProps<{ node: GraphNode; onOpenCommand: (commandId: string) => void }>) {
  const n = data.node;
  return (
    <div className="ablation-node" title={`${n.one_liner}\n${n.node_date} · ${n.run_count} run(s)`}>
      {/* Both a source and target handle on each side, so an edge can attach to
          whichever side geometry dictates (see load()); the pair is stacked at
          the same spot and reads as a single connection dot. */}
      <Handle id="l-target" type="target" position={Position.Left} />
      <Handle id="l-source" type="source" position={Position.Left} />
      {n.run_set_badge && (
        <span className="an-badge" title="Run set">{n.run_set_badge}</span>
      )}
      <div className="an-title">{n.one_liner}</div>
      <div className="an-meta">
        {n.node_date} · {n.run_count} run{n.run_count === 1 ? "" : "s"}
      </div>
      <div className="an-chips">
        {n.environments.map((e) => (
          <span key={e} className="an-chip env">
            {e}
          </span>
        ))}
        {n.commits.map((c) => (
          <span key={c} className="an-chip commit">
            {c}
          </span>
        ))}
      </div>
      {n.commands.length > 0 && (
        <div className="an-cmds">
          {n.commands.map((c) => (
            <button
              key={c.id}
              className="an-cmd"
              title={`Open command “${c.name}” to reproduce these runs`}
              onClick={(e) => {
                e.stopPropagation();
                data.onOpenCommand(c.id);
              }}
            >
              ⌘ {c.name}
            </button>
          ))}
        </div>
      )}
      {n.result && <div className="an-result">✓ {n.result.slice(0, 60)}{n.result.length > 60 ? "…" : ""}</div>}
      <Handle id="r-target" type="target" position={Position.Right} />
      <Handle id="r-source" type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { ablation: AblationNode };

export default function ExperimentGraph({
  experimentId,
  onOpenCommand,
}: {
  experimentId: string;
  onOpenCommand: (commandId: string) => void;
}) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);

  // Remember node positions so reloads (after an edit or a new link) don't
  // re-run the layout and shuffle nodes around.
  const posRef = useRef<Record<string, { x: number; y: number }>>({});
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rfNodes.forEach((n) => {
      posRef.current[n.id] = n.position;
    });
  }, [rfNodes]);

  const load = useCallback(async () => {
    const g = await fetchGraph(experimentId);
    setGraph(g);
    const auto = layout(g.nodes, g.edges);
    // Prefer an in-session position (a drag this session), then the position
    // persisted in the DB, then the auto-layout fallback for brand-new nodes.
    const dbPos: Record<string, { x: number; y: number }> = {};
    g.nodes.forEach((n) => {
      if (n.pos_x != null && n.pos_y != null) dbPos[n.id] = { x: n.pos_x, y: n.pos_y };
    });
    const posOf = (id: string) =>
      posRef.current[id] ?? dbPos[id] ?? auto[id] ?? { x: 0, y: 0 };
    setRfNodes(
      g.nodes.map<Node>((n) => ({
        id: n.id,
        type: "ablation",
        position: posOf(n.id),
        data: { node: n, onOpenCommand },
      }))
    );
    setRfEdges(
      g.edges.map<Edge>((e) => {
        // Attachment sides are chosen by geometry: the physically-left node
        // connects on its right, the physically-right node on its left. The
        // arrowhead (markerEnd) always sits at the semantic target, so
        // reversing an edge moves the arrow without moving the endpoints.
        const leftIsSource = posOf(e.source_id).x <= posOf(e.target_id).x;
        return {
          id: e.id,
          source: e.source_id,
          target: e.target_id,
          sourceHandle: leftIsSource ? "r-source" : "l-source",
          targetHandle: leftIsSource ? "l-target" : "r-target",
          animated: true,
          style: { stroke: EDGE_COLOR, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 18, height: 18 },
        };
      })
    );
  }, [experimentId, onOpenCommand, setRfNodes, setRfEdges]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  const onConnect = useCallback(
    async (c: Connection) => {
      if (!c.source || !c.target) return;
      try {
        await createEdge(experimentId, { source_id: c.source, target_id: c.target });
        await load();
      } catch (e) {
        setError(String(e));
      }
    },
    [experimentId, load]
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (linkMode) {
        // Click-to-link: first click is the source, second is the target, so
        // the arrow points to the second node clicked. (The sides the line
        // attaches to are decided by geometry in load(), independent of this.)
        if (!linkSource) {
          setLinkSource(node.id);
        } else if (linkSource !== node.id) {
          const src = linkSource;
          setLinkSource(null);
          setLinkMode(false);
          createEdge(experimentId, { source_id: src, target_id: node.id })
            .then(load)
            .catch((e) => setError(String(e)));
        }
        return;
      }
      const gn = graph?.nodes.find((n) => n.id === node.id) ?? null;
      setSelected(gn);
      setSelectedEdge(null);
    },
    [graph, linkMode, linkSource, experimentId, load]
  );

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setSelectedEdge(edge);
    setSelected(null);
  }, []);

  const deleteSelectedEdge = useCallback(async () => {
    if (!selectedEdge) return;
    const id = selectedEdge.id;
    setSelectedEdge(null);
    try {
      await deleteEdge(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }, [selectedEdge, load]);

  // Reverse a link's arrow: there's no dedicated endpoint, so delete the edge
  // and recreate it with source/target swapped.
  const reverseSelectedEdge = useCallback(async () => {
    if (!selectedEdge) return;
    const { id, source, target } = selectedEdge;
    setSelectedEdge(null);
    try {
      await deleteEdge(id);
      await createEdge(experimentId, { source_id: target, target_id: source });
      await load();
    } catch (e) {
      setError(String(e));
    }
  }, [selectedEdge, experimentId, load]);

  const exportPng = useCallback(async () => {
    const vp = canvasRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!vp) return;
    const input = window.prompt("Save graph as (filename):", "");
    if (input === null) return; // cancelled
    const trimmed = input.trim();
    if (!trimmed) return;
    // Append .png only when no extension was supplied.
    const filename = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.png`;
    try {
      const dataUrl = await toPng(vp, { backgroundColor: "#ffffff", cacheBust: true });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      a.click();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      try {
        await Promise.all(deleted.map((e) => deleteEdge(e.id)));
        await load();
      } catch (e) {
        setError(String(e));
      }
    },
    [load]
  );

  const onNodesDelete = useCallback(
    async (deleted: Node[]) => {
      try {
        await Promise.all(deleted.map((n) => deleteNode(n.id)));
        setSelected(null);
        await load();
      } catch (e) {
        setError(String(e));
      }
    },
    [load]
  );

  // Persist a node's position after a drag so the layout survives reloads.
  const onNodeDragStop = useCallback(async (_: unknown, node: Node) => {
    posRef.current[node.id] = node.position;
    try {
      await setNodePosition(node.id, node.position.x, node.position.y);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <button className="primary" onClick={() => setAdding(true)}>
          + Add node
        </button>
        <button
          className={linkMode ? "primary" : "clear"}
          onClick={() => {
            setLinkMode((v) => !v);
            setLinkSource(null);
          }}
        >
          {linkMode ? "Cancel linking" : "Link nodes"}
        </button>
        <button className="clear" onClick={exportPng}>
          Export PNG
        </button>
        {selectedEdge && (
          <>
            <button className="clear" onClick={reverseSelectedEdge}>
              ⇄ Reverse direction
            </button>
            <button className="np-delete-btn" onClick={deleteSelectedEdge}>
              Delete link
            </button>
          </>
        )}
        {linkMode ? (
          <span className="hint">
            {linkSource ? "Now click the target node." : "Click the source node."}
          </span>
        ) : (
          !selectedEdge && (
            <span className="hint">
              Drag from a node's right edge to another to link them, or use “Link nodes”. Click a link to select it.
            </span>
          )
        )}
      </div>
      {error && <div className="error">{error}</div>}

      <div className="graph-canvas" ref={canvasRef}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => setSelectedEdge(null)}
          onEdgesDelete={onEdgesDelete}
          onNodesDelete={onNodesDelete}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {selected && (
        <NodePanel
          key={selected.id}
          node={selected}
          onOpenCommand={onOpenCommand}
          onClose={() => setSelected(null)}
          onDeleted={async () => {
            setSelected(null);
            await load();
          }}
          onSaved={async () => {
            const g = await fetchGraph(experimentId);
            setGraph(g);
            setSelected(g.nodes.find((n) => n.id === selected.id) ?? null);
            await load();
          }}
        />
      )}

      {adding && (
        <AddNodeForm
          experimentId={experimentId}
          onClose={() => setAdding(false)}
          onCreated={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function NodePanel({
  node,
  onOpenCommand,
  onClose,
  onSaved,
  onDeleted,
}: {
  node: GraphNode;
  onOpenCommand: (commandId: string) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [result, setResult] = useState(node.result ?? "");
  const [oneLiner, setOneLiner] = useState(node.one_liner);
  const [editingOneLiner, setEditingOneLiner] = useState(false);
  const [nodeDate, setNodeDate] = useState(node.node_date);
  const [editingDate, setEditingDate] = useState(false);
  const [addingRuns, setAddingRuns] = useState(false);
  const [newRunIds, setNewRunIds] = useState<string[]>([]);
  const [runSets, setRunSets] = useState<RunSet[]>([]);
  const [commands, setCommands] = useState<SavedCommand[]>([]);
  const [addingCmds, setAddingCmds] = useState(false);
  const [newCmdIds, setNewCmdIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(node.result ?? "");
    setOneLiner(node.one_liner);
    setNodeDate(node.node_date);
  }, [node]);

  useEffect(() => {
    fetchRunSets().then(setRunSets).catch(() => {});
    fetchSavedCommands().then(setCommands).catch(() => {});
  }, []);

  const withBusy = async (fn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveResult = () => withBusy(async () => {
    await updateNode(node.id, { result });
    await onSaved();
    onClose();
  });

  const saveOneLiner = () => {
    if (!oneLiner.trim()) {
      setError("One-liner cannot be empty.");
      return;
    }
    return withBusy(async () => {
      await updateNode(node.id, { one_liner: oneLiner.trim() });
      setEditingOneLiner(false);
      await onSaved();
    });
  };

  const saveDate = () => {
    if (!nodeDate) {
      setError("Date cannot be empty.");
      return;
    }
    return withBusy(async () => {
      await updateNode(node.id, { node_date: nodeDate });
      setEditingDate(false);
      await onSaved();
    });
  };

  const addRuns = () => withBusy(async () => {
    if (newRunIds.length) await addRunsToNode(node.id, newRunIds);
    setNewRunIds([]);
    setAddingRuns(false);
    await onSaved();
  });

  const removeRun = (runId: string) => withBusy(async () => {
    await removeRunFromNode(node.id, runId);
    await onSaved();
  });

  const addCommands = () => withBusy(async () => {
    if (newCmdIds.length) await addCommandsToNode(node.id, newCmdIds);
    setNewCmdIds([]);
    setAddingCmds(false);
    await onSaved();
  });

  const removeCommand = (commandId: string) => withBusy(async () => {
    await removeCommandFromNode(node.id, commandId);
    await onSaved();
  });

  const attachedCmdIds = new Set(node.commands.map((c) => c.id));
  const availableCmds = commands.filter((c) => !attachedCmdIds.has(c.id));
  const toggleNewCmd = (id: string) =>
    setNewCmdIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const attachRunSet = (runSetId: string) => {
    if (!runSetId) return;
    if (!window.confirm("Attach this run set? It replaces the node's current runs and adds the badge.")) return;
    return withBusy(async () => {
      await setNodeRunSet(node.id, runSetId);
      await onSaved();
    });
  };

  const del = () => {
    if (!window.confirm("Delete node? Its links will be removed too.")) return;
    return withBusy(async () => {
      await deleteNode(node.id);
      await onDeleted();
    });
  };

  return (
    <aside className="node-panel">
      <div className="np-head">
        {editingOneLiner ? (
          <input
            {...noAssist}
            className="np-oneliner-input"
            maxLength={50}
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            autoFocus
          />
        ) : (
          <strong>{node.one_liner}</strong>
        )}
        <button className="np-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="np-oneliner-actions">
        {editingOneLiner ? (
          <>
            <button className="np-link-btn" onClick={saveOneLiner} disabled={saving}>save</button>
            <button className="np-link-btn" onClick={() => { setEditingOneLiner(false); setOneLiner(node.one_liner); }}>cancel</button>
          </>
        ) : (
          <button className="np-link-btn" onClick={() => setEditingOneLiner(true)}>edit</button>
        )}
      </div>
      <div className="np-meta">
        {editingDate ? (
          <>
            <input
              type="date"
              className="np-date-input"
              value={nodeDate}
              onChange={(e) => setNodeDate(e.target.value)}
            />
            <button className="np-link-btn" onClick={saveDate} disabled={saving}>save</button>
            <button className="np-link-btn" onClick={() => { setEditingDate(false); setNodeDate(node.node_date); }}>cancel</button>
          </>
        ) : (
          <>
            {node.node_date}
            <button className="np-link-btn" onClick={() => setEditingDate(true)}>edit</button>
          </>
        )}
        {" · "}
        {node.run_count} run{node.run_count === 1 ? "" : "s"}
      </div>

      <div className="np-section">
        Runs
        <button className="np-link-btn" onClick={() => setAddingRuns((v) => !v)}>
          {addingRuns ? "close" : "+ add runs"}
        </button>
      </div>
      {addingRuns && (
        <div className="np-add-runs">
          <RunPicker selected={newRunIds} onChange={setNewRunIds} />
          <button className="primary" onClick={addRuns} disabled={saving || newRunIds.length === 0}>
            Add {newRunIds.length || ""} run{newRunIds.length === 1 ? "" : "s"}
          </button>
        </div>
      )}
      <ul className="np-runs">
        {node.runs.map((r) => (
          <li key={r.id}>
            <a href={r.url} target="_blank" rel="noreferrer" className="run-link">
              {r.display_name}
            </a>
            <span className="commit-sha"> {r.commit ? r.commit.slice(0, 7) : "—"}</span>
            <button className="np-run-remove" title="Remove run from node" onClick={() => removeRun(r.id)} disabled={saving}>
              ×
            </button>
          </li>
        ))}
        {node.runs.length === 0 && <li className="muted">No runs linked.</li>}
      </ul>

      <div className="np-section">
        Run set
        {node.run_set_badge && <span className="an-badge np-badge">{node.run_set_badge}</span>}
      </div>
      <select
        className="np-runset-select"
        value=""
        disabled={saving || runSets.length === 0}
        onChange={(e) => attachRunSet(e.target.value)}
      >
        <option value="" disabled>
          {runSets.length ? "Attach a run set…" : "No run sets yet"}
        </option>
        {runSets.map((rs) => (
          <option key={rs.id} value={rs.id}>
            {rs.name} ({rs.run_count})
          </option>
        ))}
      </select>

      <div className="np-section">
        Commands
        <button
          className="np-link-btn"
          onClick={() => setAddingCmds((v) => !v)}
          disabled={availableCmds.length === 0 && !addingCmds}
        >
          {addingCmds ? "close" : "+ add"}
        </button>
      </div>
      {addingCmds && (
        <div className="np-add-cmds">
          {availableCmds.length === 0 ? (
            <div className="muted">All saved commands are already attached.</div>
          ) : (
            <>
              <ul className="cmd-pick">
                {availableCmds.map((c) => (
                  <li key={c.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={newCmdIds.includes(c.id)}
                        onChange={() => toggleNewCmd(c.id)}
                      />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
              <button className="primary" onClick={addCommands} disabled={saving || newCmdIds.length === 0}>
                Add {newCmdIds.length || ""} command{newCmdIds.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      )}
      <ul className="np-runs">
        {node.commands.map((c) => (
          <li key={c.id}>
            <button className="cmd-link" title="Open in Saved commands" onClick={() => onOpenCommand(c.id)}>
              ⌘ {c.name}
            </button>
            <button
              className="np-run-remove"
              title="Remove command from node"
              onClick={() => removeCommand(c.id)}
              disabled={saving}
            >
              ×
            </button>
          </li>
        ))}
        {node.commands.length === 0 && <li className="muted">No commands linked.</li>}
      </ul>

      <div className="np-section">Result</div>
      <textarea
        {...noAssist}
        className="np-result"
        maxLength={300}
        value={result}
        placeholder="What did this set of runs show?"
        onChange={(e) => setResult(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      <div className="np-actions">
        <button className="primary" onClick={saveResult} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="np-delete-btn" onClick={del} disabled={saving}>
          Delete node
        </button>
      </div>
    </aside>
  );
}

function AddNodeForm({
  experimentId,
  onClose,
  onCreated,
}: {
  experimentId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [oneLiner, setOneLiner] = useState("");
  const [nodeDate, setNodeDate] = useState("");
  const [runIds, setRunIds] = useState<string[]>([]);
  const [runSetId, setRunSetId] = useState("");
  const [runSets, setRunSets] = useState<RunSet[]>([]);
  const [commands, setCommands] = useState<SavedCommand[]>([]);
  const [commandIds, setCommandIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchRunSets().then(setRunSets).catch(() => {});
    fetchSavedCommands().then(setCommands).catch(() => {});
  }, []);

  const toggleCommand = (id: string) =>
    setCommandIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async () => {
    const errs: string[] = [];
    if (!oneLiner.trim()) errs.push("One-liner is required.");
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      await createNode(experimentId, {
        one_liner: oneLiner.trim(),
        node_date: nodeDate || undefined,
        // A run set (if chosen) defines the node's runs and its badge; otherwise
        // the individually-picked runs are used.
        run_ids: runSetId ? [] : runIds,
        command_ids: commandIds,
        run_set_id: runSetId || undefined,
      });
      await onCreated();
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = useMemo(() => oneLiner.trim().length > 0 && !busy, [oneLiner, busy]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New node</h3>
        <label className="field">
          <span className="field-label">One-liner <span className="req">*</span></span>
          <input {...noAssist} maxLength={50} value={oneLiner} onChange={(e) => setOneLiner(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" value={nodeDate} onChange={(e) => setNodeDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Populate from run set (optional)</span>
          <select value={runSetId} onChange={(e) => setRunSetId(e.target.value)}>
            <option value="">— none —</option>
            {runSets.map((rs) => (
              <option key={rs.id} value={rs.id}>
                {rs.name} ({rs.run_count})
              </option>
            ))}
          </select>
        </label>
        {runSetId ? (
          <div className="muted">Runs and the badge come from the selected run set.</div>
        ) : (
          <div className="field">
            <span className="field-label">Attach existing runs</span>
            <RunPicker selected={runIds} onChange={setRunIds} />
          </div>
        )}
        <div className="field">
          <span className="field-label">Attach saved commands (optional)</span>
          {commands.length === 0 ? (
            <div className="muted">No saved commands yet.</div>
          ) : (
            <ul className="cmd-pick">
              {commands.map((c) => (
                <li key={c.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={commandIds.includes(c.id)}
                      onChange={() => toggleCommand(c.id)}
                    />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        {errors.map((msg, i) => (
          <div className="error" key={i}>{msg}</div>
        ))}
        <div className="modal-actions">
          <button className="clear" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? "Creating…" : "Create node"}
          </button>
        </div>
      </div>
    </div>
  );
}
