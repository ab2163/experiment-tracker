import type { Folder } from "../types";
import { moveOptions } from "../folderUtils";

/** A compact "move to folder" dropdown. Value reflects the current location;
 *  changing it moves the item/folder. `excludeIds` hides invalid destinations
 *  (e.g. a folder's own subtree). */
export default function MoveToMenu({
  folders,
  currentFolderId,
  excludeIds,
  onMove,
  disabled,
}: {
  folders: Folder[];
  currentFolderId: string | null;
  excludeIds?: Set<string>;
  onMove: (folderId: string | null) => void;
  disabled?: boolean;
}) {
  const opts = moveOptions(folders, excludeIds);
  return (
    <select
      className="move-select"
      title="Move to folder"
      value={currentFolderId ?? ""}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onMove(e.target.value || null);
      }}
    >
      {opts.map((o) => (
        <option key={o.id ?? "__root__"} value={o.id ?? ""}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
