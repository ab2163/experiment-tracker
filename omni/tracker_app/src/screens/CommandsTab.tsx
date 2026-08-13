import { useEffect, useMemo, useState } from "react"
import { Stack, Card, Text, Group, Button, Code, Box, SimpleGrid, Anchor, Modal, TextInput, Textarea, Paper, CloseButton } from "@mantine/core"
import { EmptyState } from "@shared/omni-ui"
import { useTracker, type CommandRow, type FolderRow } from "../lib/data"
import { childFolders } from "../lib/folders"
import { Breadcrumb, FolderTile, NewFolderControl, MoveToMenu, SharedFolderTile } from "./FolderChrome"
import { createFolder, renameFolder, moveFolder, deleteFolderCascade, createCommand, updateCommand, deleteCommand, moveCommand, setVisibility } from "../lib/ops"
import { useConfirm } from "../lib/confirm"
import { useMe, ownedByMe, sharedByOther, SharedBadge, SHARED_FOLDER_NAME } from "../lib/sharing"

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function CommandCard({
  c,
  selected,
  readOnly,
  folders,
  onSelect,
  onEdit,
  onMove,
  onDelete,
  onToggleShare,
}: {
  c: CommandRow
  selected: boolean
  readOnly: boolean
  folders: FolderRow[]
  onSelect: () => void
  onEdit: () => void
  onMove: (dest: string | null) => void
  onDelete: () => void
  onToggleShare: () => void
}) {
  return (
    <Card
      withBorder
      shadow="sm"
      padding="sm"
      radius="md"
      onClick={onSelect}
      style={{ cursor: "pointer", borderColor: selected ? "var(--mantine-color-blue-5)" : undefined, borderWidth: selected ? 2 : undefined }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text fw={600} truncate>{c.name}</Text>
          {c.visibility === "public" && <SharedBadge />}
        </Group>
        {!readOnly && (
          <Group gap={8} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
            <Anchor size="xs" c="teal" onClick={onToggleShare}>{c.visibility === "public" ? "unshare" : "share"}</Anchor>
            <Anchor size="xs" onClick={onEdit}>edit</Anchor>
            <MoveToMenu folders={folders} onMove={onMove} />
            <Anchor size="xs" c="red" onClick={onDelete}>×</Anchor>
          </Group>
        )}
      </Group>
    </Card>
  )
}

// The full command, shown at the bottom of the tab for the selected card.
function CommandDetail({ c, onClose }: { c: CommandRow; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Paper withBorder shadow="sm" p="md" radius="md">
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Text fw={600}>{c.name}</Text>
          {c.visibility === "public" && <SharedBadge />}
        </Group>
        <Group gap={8} wrap="nowrap">
          <Button
            size="xs"
            variant="light"
            onClick={async () => { const ok = await copyText(c.command); setCopied(ok); setTimeout(() => setCopied(false), 1500) }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <CloseButton onClick={onClose} aria-label="Hide command" />
        </Group>
      </Group>
      <Box style={{ overflowX: "auto" }}>
        <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.command}</Code>
      </Box>
    </Paper>
  )
}

export function CommandsTab({ openCommandId, onOpened }: { openCommandId?: string | null; onOpened?: () => void } = {}) {
  const { data, mutate } = useTracker()
  const confirm = useConfirm()
  const me = useMe()
  const [folderId, setFolderId] = useState<string | null>(null)
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CommandRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // A command chip on a stage node jumped here — open the command's folder and reveal it.
  useEffect(() => {
    if (!openCommandId) return
    const cmd = data!.commands.find((c) => c.id === openCommandId)
    if (cmd) {
      setShared(!ownedByMe(cmd.created_by, me))
      setFolderId(cmd.folder_id)
      setSelectedId(cmd.id)
    }
    onOpened?.()
  }, [openCommandId]) // eslint-disable-line react-hooks/exhaustive-deps

  const folders = useMemo(
    () => data!.folders.filter((f) => f.kind === "command" && ownedByMe(f.created_by, me)),
    [data, me],
  )
  const sharedItems = useMemo(() => data!.commands.filter((c) => sharedByOther(c, me)), [data, me])
  const subfolders = childFolders(folders, folderId)
  const items = shared
    ? sharedItems
    : data!.commands.filter((c) => c.folder_id === folderId && ownedByMe(c.created_by, me))
  const selected = selectedId ? data!.commands.find((c) => c.id === selectedId) : undefined

  const navigate = (fid: string | null) => { setFolderId(fid); setShared(false); setSelectedId(null) }
  const openShared = () => { setShared(true); setSelectedId(null) }
  const guard = (p: Promise<unknown>) => p.catch((e) => setError(e instanceof Error ? e.message : String(e)))

  return (
    <Stack p="md" gap="md">
      <Group justify="space-between">
        {shared ? (
          <Group gap={4}>
            <Anchor size="sm" onClick={() => navigate(null)}>Root</Anchor>
            <Text size="sm" c="dimmed">/</Text>
            <Text size="sm" fw={600}>{SHARED_FOLDER_NAME.command}</Text>
          </Group>
        ) : (
          <Breadcrumb folders={folders} folderId={folderId} onNavigate={navigate} />
        )}
        {!shared && (
          <Group gap="xs">
            <NewFolderControl onCreate={(name) => guard(createFolder(name, "command", folderId, mutate)) as Promise<void>} />
            <Button size="xs" onClick={() => setCreating(true)}>+ New command</Button>
          </Group>
        )}
      </Group>
      {error && <Text c="red" size="sm">{error}</Text>}

      {!shared && (subfolders.length > 0 || (folderId === null && sharedItems.length > 0)) && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {folderId === null && sharedItems.length > 0 && (
            <SharedFolderTile name={SHARED_FOLDER_NAME.command} count={sharedItems.length} onOpen={openShared} />
          )}
          {subfolders.map((f) => (
            <FolderTile
              key={f.id}
              folder={f}
              folders={folders}
              onOpen={() => navigate(f.id)}
              onRename={(name) => guard(renameFolder(f.id, name, mutate))}
              onMove={(dest) => guard(moveFolder(f.id, dest, mutate))}
              onDelete={async () => {
                if (await confirm({ title: "Delete folder", message: `Delete folder “${f.name}” and everything inside it? This cannot be undone.` }))
                  guard(deleteFolderCascade(f.id, "command", data!, mutate))
              }}
            />
          ))}
        </SimpleGrid>
      )}

      {items.length === 0 ? (
        <EmptyState title={shared ? "Nothing shared here." : "No commands here."} description="" />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {items.map((c) => (
            <CommandCard
              key={c.id}
              c={c}
              readOnly={shared}
              folders={folders}
              selected={c.id === selectedId}
              onSelect={() => setSelectedId((cur) => (cur === c.id ? null : c.id))}
              onEdit={() => setEditing(c)}
              onMove={(dest) => guard(moveCommand(c.id, dest, mutate))}
              onToggleShare={() => guard(setVisibility("command", c.id, c.visibility === "public" ? "private" : "public", mutate))}
              onDelete={async () => { if (await confirm({ title: "Delete command", message: `Delete command “${c.name}”?` })) guard(deleteCommand(c.id, mutate)) }}
            />
          ))}
        </SimpleGrid>
      )}

      {selected && <CommandDetail c={selected} onClose={() => setSelectedId(null)} />}

      {(creating || editing) && (
        <CommandForm
          initial={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSubmit={async (name, command) => {
            if (editing) await guard(updateCommand(editing.id, name, command, mutate))
            else await guard(createCommand(name, command, folderId, mutate))
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </Stack>
  )
}

function CommandForm({
  initial,
  onClose,
  onSubmit,
}: {
  initial?: CommandRow
  onClose: () => void
  onSubmit: (name: string, command: string) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [command, setCommand] = useState(initial?.command ?? "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || !command.trim()) {
      setErr("Name and command are both required.")
      return
    }
    setBusy(true)
    try {
      await onSubmit(name.trim(), command)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened onClose={onClose} title={initial ? "Edit command" : "New command"} centered size="lg">
      <Stack gap="sm">
        <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <Textarea
          label="Command"
          required
          autosize
          minRows={4}
          value={command}
          onChange={(e) => setCommand(e.currentTarget.value)}
          styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
        />
        {err && <Text c="red" size="sm">{err}</Text>}
        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>Cancel</Button>
          <Button size="xs" onClick={submit} loading={busy}>{initial ? "Save" : "Create"}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
