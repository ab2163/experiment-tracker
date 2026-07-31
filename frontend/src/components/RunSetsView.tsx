import { useEffect, useState } from "react";
import {
  addRunsToRunSet,
  deleteRunSet,
  fetchFolders,
  fetchRunSets,
  mergeRunSets,
  moveRunSet,
  removeRunFromRunSet,
  renameRunSet,
} from "../api";
import type { Folder, RunSet } from "../types";
import { childFolders } from "../folderUtils";
import { noAssist } from "../uiHelpers";
import RunPicker from "./RunPicker";
import MoveToMenu from "./MoveToMenu";
import { Breadcrumb, FolderCard, NewFolderControl } from "./FolderChrome";

export default function RunSetsView({
  folderId,
  setFolderId,
}: {
  folderId: string | null;
  setFolderId: (id: string | null) => void;
}) {
  const [runSets, setRunSets] = useState<RunSet[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selected, setSelected] = useState<RunSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSel, setMergeSel] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);

  const load = async () => {
    try {
      const [rs, fld] = await Promise.all([fetchRunSets(), fetchFolders("run_set")]);
      setRunSets(rs);
      setFolders(fld);
      setSelected((cur) => (cur ? rs.find((v) => v.id === cur.id) ?? null : null));
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const exitMerge = () => {
    setMergeMode(false);
    setMergeSel([]);
    setMergeName("");
  };

  const toggleMerge = (id: string) =>
    setMergeSel((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  const doMerge = async () => {
    if (!mergeName.trim() || mergeSel.length < 2) return;
    setMergeBusy(true);
    try {
      await mergeRunSets({ name: mergeName.trim(), source_ids: mergeSel, folder_id: folderId });
      exitMerge();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setMergeBusy(false);
    }
  };

  const subfolders = childFolders(folders, folderId);
  const currentRunSets = runSets.filter((rs) => (rs.folder_id ?? null) === folderId);

  return (
    <div>
      <Breadcrumb
        folders={folders}
        folderId={folderId}
        onNavigate={(id) => {
          setFolderId(id);
          setSelected(null);
          exitMerge();
        }}
      />

      <div className="filters">
        {mergeMode ? (
          <>
            <input
              {...noAssist}
              className="np-oneliner-input"
              placeholder="Name for the merged set…"
              value={mergeName}
              onChange={(e) => setMergeName(e.target.value)}
              autoFocus
            />
            <button
              className="primary"
              onClick={doMerge}
              disabled={mergeBusy || mergeSel.length < 2 || !mergeName.trim()}
            >
              {mergeBusy ? "Merging…" : `Merge ${mergeSel.length || ""} set${mergeSel.length === 1 ? "" : "s"}`}
            </button>
            <button className="clear" onClick={exitMerge} disabled={mergeBusy}>
              Cancel
            </button>
            <span className="hint">Select two or more sets in this folder to copy into a new merged set.</span>
          </>
        ) : (
          <>
            <NewFolderControl kind="run_set" parentId={folderId} onChanged={load} onError={setError} />
            <button
              className="clear"
              onClick={() => {
                setSelected(null);
                setMergeMode(true);
              }}
              disabled={currentRunSets.length < 2}
            >
              Merge sets
            </button>
          </>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {subfolders.length === 0 && currentRunSets.length === 0 && (
        <div className="muted">This folder is empty.</div>
      )}

      <div className="card-grid">
        {!mergeMode &&
          subfolders.map((f) => (
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
        {currentRunSets.map((v) => (
          <RunSetCard
            key={v.id}
            runSet={v}
            folders={folders}
            active={selected?.id === v.id}
            mergeMode={mergeMode}
            mergeChecked={mergeSel.includes(v.id)}
            onOpen={() =>
              mergeMode ? toggleMerge(v.id) : setSelected(selected?.id === v.id ? null : v)
            }
            onChanged={load}
            onError={setError}
          />
        ))}
      </div>

      {!mergeMode && selected && (
        <RunSetDetail runSet={selected} onChanged={load} onError={setError} />
      )}
    </div>
  );
}

function RunSetCard({
  runSet,
  folders,
  active,
  mergeMode,
  mergeChecked,
  onOpen,
  onChanged,
  onError,
}: {
  runSet: RunSet;
  folders: Folder[];
  active: boolean;
  mergeMode: boolean;
  mergeChecked: boolean;
  onOpen: () => void;
  onChanged: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(runSet.name);

  const saveName = async () => {
    if (!name.trim()) return;
    try {
      await renameRunSet(runSet.id, name.trim());
      setRenaming(false);
      await onChanged();
    } catch (e) {
      onError(String(e));
    }
  };

  const cls = ["card-tile", active ? "active-card" : "", mergeChecked ? "merge-checked" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} onClick={onOpen}>
      {!mergeMode && (
        <div className="mc-move" onClick={(e) => e.stopPropagation()}>
          <MoveToMenu
            folders={folders}
            currentFolderId={runSet.folder_id ?? null}
            onMove={async (dest) => {
              try {
                await moveRunSet(runSet.id, dest);
                await onChanged();
              } catch (e) {
                onError(String(e));
              }
            }}
          />
        </div>
      )}
      <div className="mc-top">
        {runSet.short_id && <span className="an-badge mc-badge">{runSet.short_id}</span>}
        <div className="mc-actions">
          {mergeMode ? (
            <input type="checkbox" checked={mergeChecked} readOnly />
          ) : (
            <>
              <span className="mc-count">{runSet.run_count} run{runSet.run_count === 1 ? "" : "s"}</span>
              <button
                className="mc-edit"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming(true);
                  setName(runSet.name);
                }}
              >
                rename
              </button>
              <button
                className="mc-delete"
                title="Delete run set"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!window.confirm("Delete this run set?")) return;
                  try {
                    await deleteRunSet(runSet.id);
                    await onChanged();
                  } catch (err) {
                    onError(String(err));
                  }
                }}
              >
                ×
              </button>
            </>
          )}
        </div>
      </div>
      {renaming ? (
        <div onClick={(e) => e.stopPropagation()}>
          <input
            {...noAssist}
            className="np-oneliner-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button className="np-link-btn" onClick={saveName}>save</button>
          <button className="np-link-btn" onClick={() => setRenaming(false)}>cancel</button>
        </div>
      ) : (
        <div className="mc-title">{runSet.name}</div>
      )}
    </div>
  );
}

function RunSetDetail({
  runSet,
  onChanged,
  onError,
}: {
  runSet: RunSet;
  onChanged: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newRunIds, setNewRunIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const addRuns = async () => {
    if (!newRunIds.length) return;
    setBusy(true);
    try {
      await addRunsToRunSet(runSet.id, newRunIds);
      setNewRunIds([]);
      setAdding(false);
      await onChanged();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeRun = async (runId: string) => {
    setBusy(true);
    try {
      await removeRunFromRunSet(runSet.id, runId);
      await onChanged();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view-detail">
      <div className="np-section">
        Runs in “{runSet.name}”
        <button className="np-link-btn" onClick={() => setAdding((v) => !v)}>
          {adding ? "close" : "+ add runs"}
        </button>
      </div>
      {adding && (
        <div className="np-add-runs">
          <RunPicker selected={newRunIds} onChange={setNewRunIds} />
          <button className="primary" onClick={addRuns} disabled={busy || newRunIds.length === 0}>
            Add {newRunIds.length || ""} run{newRunIds.length === 1 ? "" : "s"}
          </button>
        </div>
      )}
      <ul className="np-runs">
        {runSet.runs.map((r) => (
          <li key={r.id}>
            <a href={r.url} target="_blank" rel="noreferrer" className="run-link">
              {r.display_name}
            </a>
            <span className="commit-sha"> {r.commit ? r.commit.slice(0, 7) : "—"}</span>
            <button className="np-run-remove" title="Remove from run set" onClick={() => removeRun(r.id)} disabled={busy}>
              ×
            </button>
          </li>
        ))}
        {runSet.runs.length === 0 && <li className="muted">No runs in this run set.</li>}
      </ul>
    </div>
  );
}
