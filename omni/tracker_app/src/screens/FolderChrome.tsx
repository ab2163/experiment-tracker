import { useState } from "react"
import { Group, Anchor, Text, Card, UnstyledButton, Menu, Button, TextInput, Badge } from "@mantine/core"
import type { FolderRow } from "../lib/data"
import { breadcrumb, moveOptions } from "../lib/folders"
import { FolderIcon } from "../lib/icons"

/** A read-only virtual folder holding items shared by the rest of the team. */
export function SharedFolderTile({ name, count, onOpen }: { name: string; count: number; onOpen: () => void }) {
  return (
    <Card withBorder shadow="sm" padding="md" radius="md" style={{ borderStyle: "dashed" }}>
      <UnstyledButton onClick={onOpen} style={{ width: "100%" }}>
        <Group gap="xs" wrap="nowrap">
          <FolderIcon size={18} style={{ color: "var(--mantine-color-teal-6)", flexShrink: 0 }} />
          <Text fw={600} truncate title={name}>{name}</Text>
          <Badge size="xs" color="teal" variant="light" ml="auto">{count}</Badge>
        </Group>
      </UnstyledButton>
    </Card>
  )
}

export function Breadcrumb({
  folders,
  folderId,
  onNavigate,
}: {
  folders: FolderRow[]
  folderId: string | null
  onNavigate: (id: string | null) => void
}) {
  const crumbs = breadcrumb(folders, folderId)
  return (
    <Group gap={4} wrap="wrap">
      {crumbs.map((c, i) => (
        <Group gap={4} key={c.id ?? "__root__"} wrap="nowrap">
          {i > 0 && <Text size="sm" c="dimmed">/</Text>}
          {i === crumbs.length - 1 ? (
            <Text size="sm" fw={600}>{c.name}</Text>
          ) : (
            <Anchor size="sm" onClick={() => onNavigate(c.id)}>{c.name}</Anchor>
          )}
        </Group>
      ))}
    </Group>
  )
}

/** A "Move to…" dropdown listing every folder path (plus Root), excluding ids. */
export function MoveToMenu({
  folders,
  excludeIds,
  onMove,
  label = "move",
}: {
  folders: FolderRow[]
  excludeIds?: Set<string>
  onMove: (dest: string | null) => void
  label?: string
}) {
  const opts = moveOptions(folders, excludeIds)
  return (
    <Menu shadow="md" position="bottom-start" width={220}>
      <Menu.Target>
        <Anchor size="xs" component="button" type="button">{label}</Anchor>
      </Menu.Target>
      <Menu.Dropdown mah={280} style={{ overflowY: "auto" }}>
        <Menu.Label>Move to</Menu.Label>
        {opts.map((o) => (
          <Menu.Item key={o.id ?? "__root__"} onClick={() => onMove(o.id)}>
            <Text size="xs" truncate>{o.label}</Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

/** "+ New folder" — reveals an inline name input that creates under `parentId`. */
export function NewFolderControl({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onCreate(name.trim())
      setName("")
      setAdding(false)
    } finally {
      setBusy(false)
    }
  }

  if (!adding) {
    return <Button variant="default" size="xs" onClick={() => setAdding(true)}>+ New folder</Button>
  }
  return (
    <Group gap={6}>
      <TextInput
        size="xs"
        placeholder="Folder name…"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && create()}
        data-autofocus
      />
      <Button size="xs" onClick={create} loading={busy} disabled={!name.trim()}>Create</Button>
      <Button variant="subtle" size="xs" onClick={() => { setAdding(false); setName("") }}>Cancel</Button>
    </Group>
  )
}

/** A folder tile: click to open; rename inline, move, or delete (cascades). */
export function FolderTile({
  folder,
  folders,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  folder: FolderRow
  folders: FolderRow[]
  onOpen: () => void
  onRename: (name: string) => void
  onMove: (dest: string | null) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(folder.name)
  const excl = new Set<string>()
  // exclude self + descendants from move destinations
  const stack = [folder.id]
  const childrenBy = new Map<string | null, FolderRow[]>()
  for (const f of folders) {
    const a = childrenBy.get(f.parent_id) ?? []
    a.push(f)
    childrenBy.set(f.parent_id, a)
  }
  while (stack.length) {
    const cur = stack.pop()!
    excl.add(cur)
    for (const c of childrenBy.get(cur) ?? []) stack.push(c.id)
  }

  return (
    <Card withBorder shadow="sm" padding="md" radius="md">
      {renaming ? (
        <Group gap={6}>
          <TextInput
            size="xs"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && (onRename(name.trim()), setRenaming(false))}
            data-autofocus
          />
          <Anchor size="xs" onClick={() => { if (name.trim()) { onRename(name.trim()); setRenaming(false) } }}>save</Anchor>
          <Anchor size="xs" onClick={() => { setRenaming(false); setName(folder.name) }}>cancel</Anchor>
        </Group>
      ) : (
        <Group justify="space-between" wrap="nowrap">
          <UnstyledButton onClick={onOpen} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <FolderIcon size={18} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
              <Text fw={600} truncate title={folder.name}>{folder.name}</Text>
            </Group>
          </UnstyledButton>
          <Group gap={6} wrap="nowrap">
            <Anchor size="xs" onClick={() => { setRenaming(true); setName(folder.name) }}>rename</Anchor>
            <MoveToMenu folders={folders} excludeIds={excl} onMove={onMove} />
            <Anchor size="xs" c="red" onClick={onDelete}>×</Anchor>
          </Group>
        </Group>
      )}
    </Card>
  )
}
