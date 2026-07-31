import { useState } from "react";
import { createFolder, deleteFolder, moveFolder, renameFolder } from "../api";
import type { Folder, FolderKind } from "../types";
import { breadcrumb, descendantIds } from "../folderUtils";
import { noAssist } from "../uiHelpers";
import MoveToMenu from "./MoveToMenu";

/** Root / A / B breadcrumb; each crumb navigates to that folder. */
export function Breadcrumb({
  folders,
  folderId,
  onNavigate,
}: {
  folders: Folder[];
  folderId: string | null;
  onNavigate: (id: string | null) => void;
}) {
  const crumbs = breadcrumb(folders, folderId);
  return (
    <div className="breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.id ?? "__root__"}>
          {i > 0 && <span className="crumb-sep"> / </span>}
          {i === crumbs.length - 1 ? (
            <span className="crumb-current">{c.name}</span>
          ) : (
            <button className="crumb-link" onClick={() => onNavigate(c.id)}>
              {c.name}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** "+ New folder" button that reveals an inline name input creating a folder
 *  under the current parent. */
export function NewFolderControl({
  kind,
  parentId,
  onChanged,
  onError,
}: {
  kind: FolderKind;
  parentId: string | null;
  onChanged: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createFolder({ kind, name: name.trim(), parent_id: parentId });
      setName("");
      setAdding(false);
      await onChanged();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!adding) {
    return (
      <button className="clear" onClick={() => setAdding(true)}>
        + New folder
      </button>
    );
  }
  return (
    <span className="new-folder">
      <input
        {...noAssist}
        className="np-oneliner-input"
        placeholder="Folder name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()}
        autoFocus
      />
      <button className="primary" onClick={create} disabled={busy || !name.trim()}>
        Create
      </button>
      <button className="clear" onClick={() => { setAdding(false); setName(""); }} disabled={busy}>
        Cancel
      </button>
    </span>
  );
}

/** A folder tile: open on click, rename inline, move, or delete (cascades). */
export function FolderCard({
  folder,
  folders,
  onOpen,
  onChanged,
  onError,
}: {
  folder: Folder;
  folders: Folder[];
  onOpen: () => void;
  onChanged: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);

  const saveName = async () => {
    if (!name.trim()) return;
    try {
      await renameFolder(folder.id, name.trim());
      setRenaming(false);
      await onChanged();
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <div className="card-tile folder-tile" onClick={onOpen}>
      <div className="mc-top">
        <span className="folder-icon">📁</span>
        <div className="mc-actions" onClick={(e) => e.stopPropagation()}>
          <MoveToMenu
            folders={folders}
            currentFolderId={folder.parent_id}
            excludeIds={descendantIds(folders, folder.id)}
            onMove={async (dest) => {
              try {
                await moveFolder(folder.id, dest);
                await onChanged();
              } catch (e) {
                onError(String(e));
              }
            }}
          />
          <button
            className="mc-edit"
            onClick={() => {
              setRenaming(true);
              setName(folder.name);
            }}
          >
            rename
          </button>
          <button
            className="mc-delete"
            title="Delete folder"
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete folder “${folder.name}” and everything inside it (subfolders and their contents)? This cannot be undone.`
                )
              )
                return;
              try {
                await deleteFolder(folder.id);
                await onChanged();
              } catch (e) {
                onError(String(e));
              }
            }}
          >
            ×
          </button>
        </div>
      </div>
      {renaming ? (
        <div onClick={(e) => e.stopPropagation()}>
          <input
            {...noAssist}
            className="np-oneliner-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
            autoFocus
          />
          <button className="np-link-btn" onClick={saveName}>save</button>
          <button className="np-link-btn" onClick={() => setRenaming(false)}>cancel</button>
        </div>
      ) : (
        <div className="mc-title">{folder.name}</div>
      )}
    </div>
  );
}
