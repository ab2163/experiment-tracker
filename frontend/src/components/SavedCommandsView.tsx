import { useEffect, useState } from "react";
import {
  createSavedCommand,
  deleteSavedCommand,
  fetchFolders,
  fetchSavedCommands,
  moveSavedCommand,
  updateSavedCommand,
} from "../api";
import type { Folder, SavedCommand } from "../types";
import { childFolders } from "../folderUtils";
import { noAssist } from "../uiHelpers";
import MoveToMenu from "./MoveToMenu";
import { Breadcrumb, FolderCard, NewFolderControl } from "./FolderChrome";

const NAME_MAX = 60;

export default function SavedCommandsView({
  openCommandId,
  onConsumedOpen,
}: {
  openCommandId?: string | null;
  onConsumedOpen?: () => void;
}) {
  const [commands, setCommands] = useState<SavedCommand[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SavedCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SavedCommand | null>(null);

  const load = async () => {
    try {
      const [cmds, fld] = await Promise.all([fetchSavedCommands(), fetchFolders("command")]);
      setCommands(cmds);
      setFolders(fld);
      setSelected((cur) => (cur ? cmds.find((c) => c.id === cur.id) ?? null : null));
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  // A node deep-linked into a specific command: navigate to its folder, open it,
  // then clear the request so it doesn't re-open on later visits.
  useEffect(() => {
    if (!openCommandId) return;
    const target = commands.find((c) => c.id === openCommandId);
    if (target) {
      setFolderId(target.folder_id ?? null);
      setSelected(target);
      onConsumedOpen?.();
    }
  }, [openCommandId, commands, onConsumedOpen]);

  const subfolders = childFolders(folders, folderId);
  const currentCommands = commands.filter((c) => (c.folder_id ?? null) === folderId);

  return (
    <div>
      <Breadcrumb
        folders={folders}
        folderId={folderId}
        onNavigate={(id) => {
          setFolderId(id);
          setSelected(null);
        }}
      />

      <div className="filters">
        <button className="primary" onClick={() => setCreating(true)}>
          + New command
        </button>
        <NewFolderControl kind="command" parentId={folderId} onChanged={load} onError={setError} />
      </div>
      {error && <div className="error">{error}</div>}
      {subfolders.length === 0 && currentCommands.length === 0 && (
        <div className="muted">This folder is empty.</div>
      )}

      <div className="card-grid">
        {subfolders.map((f) => (
          <FolderCard
            key={f.id}
            folder={f}
            folders={folders}
            onOpen={() => {
              setFolderId(f.id);
              setSelected(null);
            }}
            onChanged={load}
            onError={setError}
          />
        ))}
        {currentCommands.map((c) => (
          <div
            key={c.id}
            className={`card-tile${selected?.id === c.id ? " active-card" : ""}`}
            onClick={() => setSelected(selected?.id === c.id ? null : c)}
          >
            <div className="mc-move" onClick={(e) => e.stopPropagation()}>
              <MoveToMenu
                folders={folders}
                currentFolderId={c.folder_id ?? null}
                onMove={async (dest) => {
                  try {
                    await moveSavedCommand(c.id, dest);
                    await load();
                  } catch (err) {
                    setError(String(err));
                  }
                }}
              />
            </div>
            <div className="mc-top">
              <div className="mc-actions" onClick={(e) => e.stopPropagation()}>
                <button className="mc-edit" title="Edit command" onClick={() => setEditing(c)}>
                  edit
                </button>
                <button
                  className="mc-delete"
                  title="Delete command"
                  onClick={async () => {
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
          folderId={folderId}
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
  folderId,
  onClose,
  onSaved,
}: {
  initial?: SavedCommand;
  folderId?: string | null;
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
      else await createSavedCommand({ ...payload, folder_id: folderId ?? null });
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
