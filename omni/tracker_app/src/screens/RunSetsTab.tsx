import { useMemo, useState } from "react"
import {
  SimpleGrid,
  Card,
  Text,
  Badge,
  Group,
  Stack,
  Anchor,
  Button,
  Checkbox,
  Modal,
  TextInput,
  Paper,
  CloseButton,
} from "@mantine/core"
import { EmptyState } from "@shared/omni-ui"
import { useTracker, type RunSetRow, type FolderRow } from "../lib/data"
import { childFolders } from "../lib/folders"
import { Breadcrumb, FolderTile, NewFolderControl, MoveToMenu, SharedFolderTile } from "./FolderChrome"
import { createFolder, renameFolder, moveFolder, deleteFolderCascade, deleteRunSet, moveRunSet, mergeRunSets, setVisibility } from "../lib/ops"
import { useConfirm } from "../lib/confirm"
import { useMe, ownedByMe, sharedByOther, SharedBadge, SHARED_FOLDER_NAME } from "../lib/sharing"

function RunSetCard({
  rs,
  folders,
  onMove,
  onDelete,
  onToggleShare,
  selectable,
  readOnly,
  mergeSelected,
  onToggleMerge,
  detailSelected,
  onSelect,
}: {
  rs: RunSetRow
  folders: FolderRow[]
  onMove: (dest: string | null) => void
  onDelete: () => void
  onToggleShare: () => void
  selectable: boolean
  readOnly: boolean
  mergeSelected: boolean
  onToggleMerge: () => void
  detailSelected: boolean
  onSelect: () => void
}) {
  return (
    <Card
      withBorder
      shadow="sm"
      padding="sm"
      radius="md"
      onClick={selectable ? onToggleMerge : onSelect}
      style={{
        cursor: "pointer",
        ...(mergeSelected ? { outline: "2px solid var(--mantine-color-blue-5)" } : {}),
        borderColor: detailSelected ? "var(--mantine-color-blue-5)" : undefined,
        borderWidth: detailSelected ? 2 : undefined,
      }}
    >
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          {selectable && <Checkbox size="xs" checked={mergeSelected} onChange={onToggleMerge} onClick={(e) => e.stopPropagation()} />}
          <Text fw={600} truncate>{rs.name}</Text>
          {rs.visibility === "public" && <SharedBadge />}
        </Group>
        {rs.short_id && (
          <Badge size="sm" color="yellow" variant="light" style={{ fontFamily: "monospace" }}>{rs.short_id}</Badge>
        )}
      </Group>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">{rs.run_count} run{rs.run_count === 1 ? "" : "s"}</Text>
        {!selectable && !readOnly && (
          <Group gap={8} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
            <Anchor size="xs" c="teal" onClick={onToggleShare}>{rs.visibility === "public" ? "unshare" : "share"}</Anchor>
            <MoveToMenu folders={folders} onMove={onMove} />
            <Anchor size="xs" c="red" onClick={onDelete}>×</Anchor>
          </Group>
        )}
      </Group>
    </Card>
  )
}

// The selected run set's full run list, shown at the bottom of the tab.
function RunSetDetail({ rs, onClose }: { rs: RunSetRow; onClose: () => void }) {
  const { data } = useTracker()
  const runs = rs.runIds.map((id) => data!.runsById.get(id)).filter(Boolean)
  return (
    <Paper withBorder shadow="sm" p="md" radius="md">
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Text fw={600}>{rs.name}</Text>
          {rs.short_id && (
            <Badge size="sm" color="yellow" variant="light" style={{ fontFamily: "monospace" }}>{rs.short_id}</Badge>
          )}
          {rs.visibility === "public" && <SharedBadge />}
          <Text size="xs" c="dimmed">{rs.run_count} run{rs.run_count === 1 ? "" : "s"}</Text>
        </Group>
        <CloseButton onClick={onClose} aria-label="Hide run set" />
      </Group>
      <Stack gap={2}>
        {runs.length === 0 ? (
          <Text size="xs" c="dimmed">No runs.</Text>
        ) : (
          runs.map((r) => (
            <Anchor key={r!.id} href={r!.url} target="_blank" rel="noreferrer" size="xs" truncate title={r!.display_name}>
              {r!.display_name}
            </Anchor>
          ))
        )}
      </Stack>
    </Paper>
  )
}

export function RunSetsTab() {
  const { data, mutate } = useTracker()
  const confirm = useConfirm()
  const me = useMe()
  const [folderId, setFolderId] = useState<string | null>(null)
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSel, setMergeSel] = useState<Record<string, boolean>>({})
  const [mergeName, setMergeName] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const folders = useMemo(
    () => data!.folders.filter((f) => f.kind === "run_set" && ownedByMe(f.created_by, me)),
    [data, me],
  )
  const myRunSets = useMemo(() => data!.runSets.filter((rs) => ownedByMe(rs.created_by, me)), [data, me])
  const sharedItems = useMemo(() => data!.runSets.filter((rs) => sharedByOther(rs, me)), [data, me])
  const subfolders = childFolders(folders, folderId)
  const items = shared ? sharedItems : myRunSets.filter((rs) => rs.folder_id === folderId)
  const selectedIds = Object.keys(mergeSel).filter((id) => mergeSel[id])
  const selected = selectedId ? data!.runSets.find((rs) => rs.id === selectedId) : undefined

  const navigate = (fid: string | null) => { setFolderId(fid); setShared(false); setMergeMode(false); setMergeSel({}); setSelectedId(null) }
  const openShared = () => { setShared(true); setMergeMode(false); setMergeSel({}); setSelectedId(null) }
  const guard = (p: Promise<unknown>) => p.catch((e) => setError(e instanceof Error ? e.message : String(e)))

  return (
    <Stack p="md" gap="md">
      <Group justify="space-between">
        {shared ? (
          <Group gap={4}>
            <Anchor size="sm" onClick={() => navigate(null)}>Root</Anchor>
            <Text size="sm" c="dimmed">/</Text>
            <Text size="sm" fw={600}>{SHARED_FOLDER_NAME.run_set}</Text>
          </Group>
        ) : (
          <Breadcrumb folders={folders} folderId={folderId} onNavigate={navigate} />
        )}
        {!shared && (
          <Group gap="xs">
            <NewFolderControl onCreate={(name) => guard(createFolder(name, "run_set", folderId, mutate)) as Promise<void>} />
            <Button
              variant={mergeMode ? "filled" : "default"}
              size="xs"
              disabled={myRunSets.length < 2}
              onClick={() => { setMergeMode((v) => !v); setMergeSel({}); setSelectedId(null) }}
            >
              {mergeMode ? "Cancel merge" : "Merge sets"}
            </Button>
            {mergeMode && (
              <Button size="xs" disabled={selectedIds.length < 2} onClick={() => setMergeName("")}>
                Merge {selectedIds.length} set{selectedIds.length === 1 ? "" : "s"}
              </Button>
            )}
          </Group>
        )}
      </Group>
      {error && <Text c="red" size="sm">{error}</Text>}

      {!shared && !mergeMode && (subfolders.length > 0 || (folderId === null && sharedItems.length > 0)) && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {folderId === null && sharedItems.length > 0 && (
            <SharedFolderTile name={SHARED_FOLDER_NAME.run_set} count={sharedItems.length} onOpen={openShared} />
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
                  guard(deleteFolderCascade(f.id, "run_set", data!, mutate))
              }}
            />
          ))}
        </SimpleGrid>
      )}

      {items.length === 0 ? (
        <EmptyState title={shared ? "Nothing shared here." : "No run sets here."} description="" />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {items.map((rs) => (
            <RunSetCard
              key={rs.id}
              rs={rs}
              folders={folders}
              selectable={mergeMode}
              readOnly={shared}
              mergeSelected={!!mergeSel[rs.id]}
              onToggleMerge={() => setMergeSel((sm) => ({ ...sm, [rs.id]: !sm[rs.id] }))}
              detailSelected={rs.id === selectedId}
              onSelect={() => setSelectedId((cur) => (cur === rs.id ? null : rs.id))}
              onMove={(dest) => guard(moveRunSet(rs.id, dest, mutate))}
              onToggleShare={() => guard(setVisibility("run_set", rs.id, rs.visibility === "public" ? "private" : "public", mutate))}
              onDelete={async () => {
                if (await confirm({ title: "Delete run set", message: `Delete run set “${rs.name}”?` })) guard(deleteRunSet(rs.id, mutate))
              }}
            />
          ))}
        </SimpleGrid>
      )}

      {selected && <RunSetDetail rs={selected} onClose={() => setSelectedId(null)} />}

      {mergeName !== null && (
        <MergeModal
          count={selectedIds.length}
          onClose={() => setMergeName(null)}
          onMerge={async (name) => {
            const sources = myRunSets.filter((r) => mergeSel[r.id])
            const existing = new Set(data!.runSets.map((r) => r.short_id).filter(Boolean) as string[])
            await guard(mergeRunSets(name, sources, folderId, existing, mutate))
            setMergeName(null)
            setMergeMode(false)
            setMergeSel({})
          }}
        />
      )}
    </Stack>
  )
}

function MergeModal({ count, onClose, onMerge }: { count: number; onClose: () => void; onMerge: (name: string) => Promise<void> }) {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <Modal opened onClose={onClose} title="Merge run sets" centered>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">New set = the deduplicated union of {count} selected sets' runs. Sources are left unchanged.</Text>
        <TextInput label="New run set name" required value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>Cancel</Button>
          <Button
            size="xs"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => { setBusy(true); try { await onMerge(name.trim()) } finally { setBusy(false) } }}
          >
            Merge
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
