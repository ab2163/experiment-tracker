import { useEffect, useState } from "react";
import { createExperiment, deleteExperiment, fetchExperiments, updateExperiment } from "../api";
import type { Experiment, ExperimentKind } from "../types";
import { noAssist } from "../uiHelpers";
import ExperimentGraph from "./ExperimentGraph";

const TITLE_MAX = 50;

export default function ExperimentsView({
  onOpenCommand,
}: {
  onOpenCommand: (commandId: string) => void;
}) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<Experiment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Experiment | null>(null);

  const load = () =>
    fetchExperiments()
      .then(setExperiments)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
  }, []);

  if (selected) {
    return (
      <div>
        <button className="clear back" onClick={() => setSelected(null)}>
          ← All experiments
        </button>
        <div className="experiment-header">
          <h2>{selected.title}</h2>
          {selected.ref_url && (
            <a href={selected.ref_url} target="_blank" rel="noreferrer" className="run-link">
              reference ↗
            </a>
          )}
        </div>
        {selected.description && <p className="subtitle">{selected.description}</p>}
        <ExperimentGraph experimentId={selected.id} onOpenCommand={onOpenCommand} />
      </div>
    );
  }

  return (
    <div>
      <div className="filters">
        <button className="primary" onClick={() => setCreating(true)}>
          + New experiment
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card-grid">
        {experiments.map((m) => (
          <div key={m.id} className="card-tile" onClick={() => setSelected(m)}>
            <div className="mc-top">
              {m.kind !== "freeform" && <span className={`kind kind-${m.kind}`}>{m.kind}</span>}
              <div className="mc-actions">
                <span className="mc-count">{m.node_count} node{m.node_count === 1 ? "" : "s"}</span>
                <button
                  className="mc-edit"
                  title="Edit experiment"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(m);
                  }}
                >
                  edit
                </button>
                <button
                  className="mc-delete"
                  title="Delete experiment"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm("Delete experiment? Its nodes and links will be removed too.")) return;
                    try {
                      await deleteExperiment(m.id);
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
            <div className="mc-title">{m.title}</div>
            {m.description && <div className="mc-desc">{m.description}</div>}
          </div>
        ))}
        {experiments.length === 0 && <div className="muted">No experiments yet.</div>}
      </div>

      {creating && (
        <ExperimentForm
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}

      {editing && (
        <ExperimentForm
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

function ExperimentForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Experiment;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<ExperimentKind | "unset">(initial?.kind ?? "unset");
  const [refUrl, setRefUrl] = useState(initial?.ref_url ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const errs: string[] = [];
    if (!title.trim()) errs.push("Title is required.");
    if (kind === "unset") errs.push("Kind is required.");
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const payload = {
        title: title.trim(),
        kind: kind as ExperimentKind,
        ref_url: refUrl.trim() || null,
        description: description.trim() || null,
      };
      if (initial) {
        await updateExperiment(initial.id, payload);
      } else {
        await createExperiment({
          title: payload.title,
          kind: payload.kind,
          ref_url: payload.ref_url ?? undefined,
          description: payload.description ?? undefined,
        });
      }
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
        <h3>{initial ? "Edit experiment" : "New experiment"}</h3>
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
          <span className="field-label">Kind <span className="req">*</span></span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ExperimentKind | "unset")}>
            <option value="unset" disabled>
              Select a kind…
            </option>
            <option value="freeform">Free-form investigation</option>
            <option value="linear">Linear ticket</option>
            <option value="pr">GitHub PR</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Reference URL (optional)</span>
          <input {...noAssist} value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea {...noAssist} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
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
