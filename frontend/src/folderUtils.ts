import type { Folder } from "./types";

/** Direct children of a folder (null parent = root level), sorted by name. */
export function childFolders(folders: Folder[], parentId: string | null): Folder[] {
  return folders
    .filter((f) => f.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Chain from Root to the given folder (inclusive). Root is { id: null }. */
export function breadcrumb(
  folders: Folder[],
  id: string | null
): { id: string | null; name: string }[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: { id: string | null; name: string }[] = [];
  let cur = id;
  while (cur !== null) {
    const f = byId.get(cur);
    if (!f) break; // stale id (e.g. folder deleted) — stop
    chain.unshift({ id: f.id, name: f.name });
    cur = f.parent_id;
  }
  chain.unshift({ id: null, name: "Root" });
  return chain;
}

/** Full path label like "Root / A / B" (null = "Root"). */
export function folderPath(folders: Folder[], id: string | null): string {
  return breadcrumb(folders, id)
    .map((c) => c.name)
    .join(" / ");
}

/** A folder and all its descendants (inclusive). */
export function descendantIds(folders: Folder[], id: string): Set<string> {
  const childrenBy = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const arr = childrenBy.get(f.parent_id) ?? [];
    arr.push(f);
    childrenBy.set(f.parent_id, arr);
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.add(cur);
    for (const c of childrenBy.get(cur) ?? []) stack.push(c.id);
  }
  return out;
}

/** Destination options for a "Move to" dropdown, sorted by path, excluding ids. */
export function moveOptions(
  folders: Folder[],
  excludeIds?: Set<string>
): { id: string | null; label: string }[] {
  const opts: { id: string | null; label: string }[] = [{ id: null, label: "Root" }];
  for (const f of folders) {
    if (excludeIds?.has(f.id)) continue;
    opts.push({ id: f.id, label: folderPath(folders, f.id) });
  }
  opts.sort((a, b) => a.label.localeCompare(b.label));
  return opts;
}
