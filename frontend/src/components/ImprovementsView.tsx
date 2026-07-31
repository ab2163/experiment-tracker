import { useEffect, useState } from "react";
import {
  createImprovement,
  deleteImprovement,
  fetchImprovements,
  updateImprovement,
} from "../api";
import type { Improvement, ImprovementStatus, Priority } from "../types";
import { noAssist } from "../uiHelpers";

const TITLE_MAX = 60;
const PRIORITY_LABEL: Record<Priority, string> = { H: "High", M: "Medium", L: "Low" };

const ticketNo = (n: number) => `#${String(n).padStart(4, "0")}`;

export default function ImprovementsView() {
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Improvement | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = () =>
    fetchImprovements()
      .then(setImprovements)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (imp: Improvement, status: ImprovementStatus) => {
    try {
      await updateImprovement(imp.id, { status });
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const del = async (imp: Improvement) => {
    if (!window.confirm(`Delete ticket ${ticketNo(imp.number)}?`)) return;
    try {
      await deleteImprovement(imp.id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const open = improvements.filter((i) => i.status !== "resolved");
  const closed = improvements.filter((i) => i.status === "resolved");

  const renderTicket = (imp: Improvement) => (
    <div key={imp.id} className="ticket">
      <div className="ticket-head">
        <span className="ticket-no">{ticketNo(imp.number)}</span>
        {imp.priority && (
          <span className={`prio prio-${imp.priority}`}>{PRIORITY_LABEL[imp.priority]}</span>
        )}
        {imp.status === "resolved" && <span className="status-badge">resolved</span>}
        <span className="ticket-title">{imp.title}</span>
        <div className="ticket-actions">
          <button
            className="mc-edit"
            onClick={() => setStatus(imp, imp.status === "resolved" ? "unresolved" : "resolved")}
          >
            {imp.status === "resolved" ? "reopen" : "resolve"}
          </button>
          <button className="mc-edit" title="Edit ticket" onClick={() => setEditing(imp)}>
            edit
          </button>
          <button className="mc-delete" title="Delete ticket" onClick={() => del(imp)}>
            ×
          </button>
        </div>
      </div>
      {imp.description && <div className="ticket-desc">{imp.description}</div>}
    </div>
  );

  return (
    <div>
      <div className="filters">
        <button className="primary" onClick={() => setCreating(true)}>
          + New ticket
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="np-section">Open tickets</div>
      <div className="ticket-list">
        {open.length === 0 && <div className="muted">No open tickets.</div>}
        {open.map(renderTicket)}
      </div>

      <div className="np-section closed-header">
        <button className="crumb-link" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "▾" : "▸"} Closed tickets ({closed.length})
        </button>
      </div>
      {showClosed && (
        <div className="ticket-list">
          {closed.length === 0 && <div className="muted">No closed tickets.</div>}
          {closed.map(renderTicket)}
        </div>
      )}

      {creating && (
        <ImprovementForm
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      {editing && (
        <ImprovementForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ImprovementForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Improvement;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState<Priority | "">(initial?.priority ?? "");
  const [status, setStatus] = useState<ImprovementStatus>(initial?.status ?? "unresolved");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      setErrors(["A title is required."]);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        priority: priority || null,
        status,
      };
      if (initial) await updateImprovement(initial.id, payload);
      else await createImprovement(payload);
      await onSaved();
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? `Edit ticket ${ticketNo(initial.number)}` : "New ticket"}</h3>
        <label className="field">
          <span className="field-label">Title <span className="req">*</span></span>
          <input
            {...noAssist}
            maxLength={TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea
            {...noAssist}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Priority (optional)</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")}>
            <option value="">— none —</option>
            <option value="H">High</option>
            <option value="M">Medium</option>
            <option value="L">Low</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ImprovementStatus)}>
            <option value="unresolved">Unresolved</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
        {errors.map((msg, i) => (
          <div className="error" key={i}>{msg}</div>
        ))}
        <div className="modal-actions">
          <button className="clear" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : initial ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
