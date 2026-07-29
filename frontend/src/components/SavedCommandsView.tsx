import { useEffect, useState } from "react";
import {
  createSavedCommand,
  deleteSavedCommand,
  fetchSavedCommands,
  updateSavedCommand,
} from "../api";
import type { SavedCommand } from "../types";
import { noAssist } from "../uiHelpers";

const NAME_MAX = 60;

export default function SavedCommandsView({
  openCommandId,
  onConsumedOpen,
}: {
  openCommandId?: string | null;
  onConsumedOpen?: () => void;
}) {
  const [commands, setCommands] = useState<SavedCommand[]>([]);
  const [selected, setSelected] = useState<SavedCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SavedCommand | null>(null);

  const load = async () => {
    try {
      const cmds = await fetchSavedCommands();
      setCommands(cmds);
      setSelected((cur) => (cur ? cmds.find((c) => c.id === cur.id) ?? null : null));
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  // A node deep-linked into a specific command: open it once, then clear the
  // request so navigating away and back doesn't re-open it.
  useEffect(() => {
    if (!openCommandId) return;
    const target = commands.find((c) => c.id === openCommandId);
    if (target) {
      setSelected(target);
      onConsumedOpen?.();
    }
  }, [openCommandId, commands, onConsumedOpen]);

  return (
    <div>
      <div className="filters">
        <button className="primary" onClick={() => setCreating(true)}>
          + New command
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {commands.length === 0 && <div className="muted">No saved commands yet.</div>}

      <div className="card-grid">
        {commands.map((c) => (
          <div
            key={c.id}
            className={`card-tile${selected?.id === c.id ? " active-card" : ""}`}
            onClick={() => setSelected(selected?.id === c.id ? null : c)}
          >
            <div className="mc-top">
              <div className="mc-actions">
                <button
                  className="mc-edit"
                  title="Edit command"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(c);
                  }}
                >
                  edit
                </button>
                <button
                  className="mc-delete"
                  title="Delete command"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm("Delete this command? It will be removed from any nodes using it."))
                      return;
                    try {
                      await deleteSavedCommand(c.id);
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
            <div className="mc-title">{c.name}</div>
          </div>
        ))}
      </div>

      {selected && <CommandDetail command={selected} onError={setError} />}

      {creating && (
        <CommandForm
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      {editing && (
        <CommandForm
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

function CommandDetail({
  command,
  onError,
}: {
  command: SavedCommand;
  onError: (e: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <div className="view-detail">
      <div className="np-section">
        {command.name}
        <button className="np-link-btn" onClick={copy}>
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="cmd-box">{command.command}</pre>
    </div>
  );
}

function CommandForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: SavedCommand;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const errs: string[] = [];
    if (!name.trim()) errs.push("A name is required.");
    if (!command.trim()) errs.push("The command cannot be empty.");
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const payload = { name: name.trim(), command: command.trim() };
      if (initial) await updateSavedCommand(initial.id, payload);
      else await createSavedCommand(payload);
      await onSaved();
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cmd-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? "Edit command" : "New command"}</h3>
        <label className="field">
          <span className="field-label">Name <span className="req">*</span></span>
          <input
            {...noAssist}
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field-label">Command <span className="req">*</span></span>
          <textarea
            {...noAssist}
            className="cmd-input"
            value={command}
            placeholder="python -m remote.submit train …"
            onChange={(e) => setCommand(e.target.value)}
          />
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
