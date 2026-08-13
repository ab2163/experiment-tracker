import { useMemo, useState } from "react"
import { SimpleGrid, Card, Text, Badge, Group, Anchor, Stack, Button, Modal, TextInput, Select } from "@mantine/core"
import { EmptyState } from "@shared/omni-ui"
import { useTracker, type ExperimentRow, type FolderRow } from "../lib/data"
import { childFolders } from "../lib/folders"
import { Breadcrumb, FolderTile, NewFolderControl, MoveToMenu, SharedFolderTile } from "./FolderChrome"
import {
  createFolder, renameFolder, moveFolder, deleteFolderCascade,
  createExperiment, updateExperiment, deleteExperiment, moveExperiment, setVisibility,
} from "../lib/ops"
import { useConfirm } from "../lib/confirm"
import { RichText, LinkTextarea } from "../lib/richtext"
import { useMe, ownedByMe, sharedByOther, SharedBadge, SHARED_FOLDER_NAME } from "../lib/sharing"

const kindColor: Record<string, string> = { linear: "blue", pr: "grape" }
const kindLabel: Record<string, string> = { linear: "Linear", pr: "PR", freeform: "Freeform" }

function ExperimentCard({
  e,
  readOnly,
  folders,
  onEdit,
  onMove,
  onDelete,
  onToggleShare,
  onOpenFlow,
}: {
  e: ExperimentRow
  readOnly: boolean
  folders: FolderRow[]
  onEdit: () => void
  onMove: (dest: string | null) => void
  onDelete: () => void
  onToggleShare: () => void
  onOpenFlow: () => void
}) {
  return (
    <Card withBorder shadow="sm" padding="md" radius="md">
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Anchor fw={600} truncate onClick={onOpenFlow} title="Open flow graph" c="inherit" underline="hover">
          {e.title}
        </Anchor>
        <Group gap={6} wrap="nowrap">
          {e.visibility === "public" && <SharedBadge />}
          {e.kind && e.kind !== "freeform" && (
            <Badge size="sm" color={kindColor[e.kind] ?? "gray"} variant="light">{kindLabel[e.kind] ?? e.kind}</Badge>
          )}
        </Group>
      </Group>
      {e.description && <Text size="sm" c="dimmed" lineClamp={3} mb={6}><RichText text={e.description} /></Text>}
      <Group justify="space-between" mt="xs">
        <Anchor size="xs" c="dimmed" onClick={onOpenFlow}>{e.node_count} stage{e.node_count === 1 ? "" : "s"} →</Anchor>
        <Group gap={8} wrap="nowrap">
          {e.ref_url && <Anchor href={e.ref_url} target="_blank" rel="noreferrer" size="xs">ref ↗</Anchor>}
          {!readOnly && (
            <>
              <Anchor size="xs" c="teal" onClick={onToggleShare}>{e.visibility === "public" ? "unshare" : "share"}</Anchor>
              <Anchor size="xs" onClick={onEdit}>edit</Anchor>
              <MoveToMenu folders={folders} onMove={onMove} />
              <Anchor size="xs" c="red" onClick={onDelete}>×</Anchor>
            </>
          )}
        </Group>
      </Group>
    </Card>
  )
}

export function ExperimentsTab({ onOpenFlow }: { onOpenFlow: (id: string, title: string) => void }) {
  const { data, mutate } = useTracker()
  const confirm = useConfirm()
  const me = useMe()
  const [folderId, setFolderId] = useState<string | null>(null)
  const [shared, setShared] = useState(false)
  const [editing, setEditing] = useState<ExperimentRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const folders = useMemo(
    () => data!.folders.filter((f) => f.kind === "experiment" && ownedByMe(f.created_by, me)),
    [data, me],
  )
  const myExps = useMemo(() => data!.experiments.filter((e) => ownedByMe(e.created_by, me)), [data, me])
  const sharedItems = useMemo(() => data!.experiments.filter((e) => sharedByOther(e, me)), [data, me])
  const subfolders = childFolders(folders, folderId)
  const items = shared ? sharedItems : myExps.filter((e) => e.folder_id === folderId)

  const navigate = (fid: string | null) => { setFolderId(fid); setShared(false) }
  const openShared = () => setShared(true)
  const guard = (p: Promise<unknown>) => p.catch((e) => setError(e instanceof Error ? e.message : String(e)))

  return (
    <Stack p="md" gap="md">
      <Group justify="space-between">
        {shared ? (
          <Group gap={4}>
            <Anchor size="sm" onClick={() => navigate(null)}>Root</Anchor>
            <Text size="sm" c="dimmed">/</Text>
            <Text size="sm" fw={600}>{SHARED_FOLDER_NAME.experiment}</Text>
          </Group>
        ) : (
          <Breadcrumb folders={folders} folderId={folderId} onNavigate={navigate} />
        )}
        {!shared && (
          <Group gap="xs">
            <NewFolderControl onCreate={(name) => guard(createFolder(name, "experiment", folderId, mutate)) as Promise<void>} />
            <Button size="xs" onClick={() => setCreating(true)}>+ New experiment</Button>
          </Group>
        )}
      </Group>
      {error && <Text c="red" size="sm">{error}</Text>}

      {!shared && (subfolders.length > 0 || (folderId === null && sharedItems.length > 0)) && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {folderId === null && sharedItems.length > 0 && (
            <SharedFolderTile name={SHARED_FOLDER_NAME.experiment} count={sharedItems.length} onOpen={openShared} />
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
                  guard(deleteFolderCascade(f.id, "experiment", data!, mutate))
              }}
            />
          ))}
        </SimpleGrid>
      )}

      {items.length === 0 ? (
        <EmptyState
          title={shared ? "Nothing shared here." : "No experiments here."}
          description={shared ? "" : "Create one to get started."}
        />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {items.map((e) => (
            <ExperimentCard
              key={e.id}
              e={e}
              readOnly={shared}
              folders={folders}
              onOpenFlow={() => onOpenFlow(e.id, e.title)}
              onEdit={() => setEditing(e)}
              onMove={(dest) => guard(moveExperiment(e.id, dest, mutate))}
              onToggleShare={() => guard(setVisibility("experiment", e.id, e.visibility === "public" ? "private" : "public", mutate))}
              onDelete={async () => { if (await confirm({ title: "Delete experiment", message: `Delete experiment “${e.title}”?` })) guard(deleteExperiment(e.id, mutate)) }}
            />
          ))}
        </SimpleGrid>
      )}

      {(creating || editing) && (
        <ExperimentForm
          initial={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSubmit={async (fields) => {
            if (editing) await guard(updateExperiment(editing.id, fields, mutate))
            else await guard(createExperiment(fields, folderId, mutate))
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </Stack>
  )
}

function ExperimentForm({
  initial,
  onClose,
  onSubmit,
}: {
  initial?: ExperimentRow
  onClose: () => void
  onSubmit: (fields: { title: string; kind: string; description: string | null; ref_url: string | null }) => Promise<void>
}) {
  const [title, setTitle] = useState(initial?.title ?? "")
  const [kind, setKind] = useState(initial?.kind ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [refUrl, setRefUrl] = useState(initial?.ref_url ?? "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim()) {
      setErr("A title is required.")
      return
    }
    if (!kind) {
      setErr("A kind is required.")
      return
    }
    setBusy(true)
    try {
      await onSubmit({ title: title.trim(), kind, description: description.trim() || null, ref_url: refUrl.trim() || null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened onClose={onClose} title={initial ? "Edit experiment" : "New experiment"} centered>
      <Stack gap="sm">
        <TextInput label="Title" required value={title} onChange={(e) => setTitle(e.currentTarget.value)} data-autofocus />
        <Select
          label="Kind"
          required
          allowDeselect={false}
          placeholder="Select a kind"
          data={[
            { value: "linear", label: "Linear" },
            { value: "pr", label: "PR" },
            { value: "freeform", label: "Freeform" },
          ]}
          value={kind || null}
          onChange={(v) => setKind(v ?? "")}
        />
        <LinkTextarea label="Description (optional)" autosize minRows={2} value={description} onChange={setDescription} description="Select text and press ⌘K / Ctrl+K to insert a link." />
        <TextInput label="Reference URL (optional)" value={refUrl} onChange={(e) => setRefUrl(e.currentTarget.value)} />
        {err && <Text c="red" size="sm">{err}</Text>}
        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>Cancel</Button>
          <Button size="xs" onClick={submit} loading={busy}>{initial ? "Save" : "Create"}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
