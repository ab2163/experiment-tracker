import { useEffect, useState } from "react";
import {
  createImprovement,
  deleteImprovement,
  fetchImprovements,
  updateImprovement,
} from "../api";
import type { Improvement, Priority } from "../types";
import { noAssist } from "../uiHelpers";

const TITLE_MAX = 60;
const PRIORITY_LABEL: Record<Priority, string> = { H: "High", M: "Medium", L: "Low" };

const ticketNo = (n: number) => `#${String(n).padStart(4, "0")}`;

export default function ImprovementsView() {
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Improvement | null>(null);

  const load = () =>
    fetchImprovements()
      .then(setImprovements)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="filters">
        <button className="primary" onClick={() => setCreating(true)}>
          + New ticket
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {improvements.length === 0 && <div className="muted">No improvement tickets yet.</div>}

      <div className="ticket-list">
        {improvements.map((imp) => (
          <div key={imp.id} className="ticket">
            <div className="ticket-head">
              <span className="ticket-no">{ticketNo(imp.number)}</span>
              {imp.priority && (
                <span className={`prio prio-${imp.priority}`}>{PRIORITY_LABEL[imp.priority]}</span>
              )}
              <span className="ticket-title">{imp.title}</span>
              <div className="ticket-actions">
                <button className="mc-edit" title="Edit ticket" onClick={() => setEditing(imp)}>
                  edit
                </button>
                <button
                  className="mc-delete"
                  title="Delete ticket"
                  onClick={async () => {
                    if (!window.confirm(`Delete ticket ${ticketNo(imp.number)}?`)) return;
                    try {
                      await deleteImprovement(imp.id);
                      await load();
                    } catch (err) {
                      setError(String(err));
                    }
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            {imp.description && <div className="ticket-desc">{imp.description}</div>}
          </div>
        ))}
      </div>

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
