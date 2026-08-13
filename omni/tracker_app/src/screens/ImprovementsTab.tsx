import { useState } from "react"
import {
  Stack,
  Group,
  Text,
  Badge,
  Paper,
  UnstyledButton,
  Button,
  Modal,
  TextInput,
  Select,
  Anchor,
} from "@mantine/core"
import { EmptyState } from "@shared/omni-ui"
import { useTracker, type ImprovementRow } from "../lib/data"
import { useConfirm } from "../lib/confirm"
import { omni, ACTIONS } from "../bridge"
import { RichText, LinkTextarea } from "../lib/richtext"

const TITLE_MAX = 60
const PRIORITY_LABEL: Record<string, string> = { H: "High", M: "Medium", L: "Low" }
const PRIORITY_COLOR: Record<string, string> = { H: "red", M: "orange", L: "gray" }
const ticketNo = (nr: number) => `#${String(nr).padStart(4, "0")}`

type Priority = "H" | "M" | "L"
type Resolution = "unresolved" | "resolved"

function Ticket({
  imp,
  onEdit,
  onToggle,
  onDelete,
}: {
  imp: ImprovementRow
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Group gap="xs" wrap="nowrap" justify="space-between">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text ff="monospace" size="sm" c="dimmed">{ticketNo(imp.number)}</Text>
          {imp.priority && (
            <Badge size="sm" variant="light" color={PRIORITY_COLOR[imp.priority]}>{PRIORITY_LABEL[imp.priority]}</Badge>
          )}
          {imp.resolution === "resolved" && <Badge size="sm" variant="light" color="green">resolved</Badge>}
          <Text fw={600} size="sm" truncate>{imp.title}</Text>
        </Group>
        <Group gap={4} wrap="nowrap">
          <Anchor size="xs" onClick={onToggle}>{imp.resolution === "resolved" ? "reopen" : "resolve"}</Anchor>
          <Anchor size="xs" onClick={onEdit}>edit</Anchor>
          <Anchor size="xs" c="red" onClick={onDelete}>×</Anchor>
        </Group>
      </Group>
      {imp.description && (
        <Text size="sm" c="dimmed" mt={4} style={{ whiteSpace: "pre-wrap" }}><RichText text={imp.description} /></Text>
      )}
    </Paper>
  )
}

interface ActionNode {
  id: string
}

export function ImprovementsTab() {
  const { data, upsertImprovementLocal, removeImprovementLocal } = useTracker()
  const confirm = useConfirm()
  const improvements = [...data!.improvements].sort((a, b) => a.number - b.number)
  const [showClosed, setShowClosed] = useState(false)
  const [editing, setEditing] = useState<ImprovementRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = improvements.filter((i) => i.resolution !== "resolved")
  const closed = improvements.filter((i) => i.resolution === "resolved")
  const nextNumber = improvements.reduce((m, i) => Math.max(m, i.number), -1) + 1

  const toggle = async (imp: ImprovementRow) => {
    const resolution: Resolution = imp.resolution === "resolved" ? "unresolved" : "resolved"
    upsertImprovementLocal({ ...imp, resolution }) // optimistic
    try {
      await omni.action(ACTIONS.updateImprovement, { node_id: imp.id, properties: { resolution } })
    } catch (e) {
      upsertImprovementLocal(imp) // revert
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const del = async (imp: ImprovementRow) => {
    if (!(await confirm({ title: "Delete ticket", message: `Delete ticket ${ticketNo(imp.number)}?` }))) return
    removeImprovementLocal(imp.id) // optimistic
    try {
      await omni.action(ACTIONS.deleteImprovement, { node_id: imp.id })
    } catch (e) {
      upsertImprovementLocal(imp) // revert
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Stack p="md" gap="md">
      <Group>
        <Button size="xs" onClick={() => setCreating(true)}>+ New ticket</Button>
      </Group>
      {error && <Text c="red" size="sm">{error}</Text>}

      {improvements.length === 0 ? (
        <EmptyState title="No tickets yet." description="Create one to get started." />
      ) : (
        <>
          <div>
            <Text fw={600} size="sm" mb="xs">Open tickets</Text>
            <Stack gap="xs">
              {open.length === 0 ? (
                <Text size="sm" c="dimmed">No open tickets.</Text>
              ) : (
                open.map((imp) => (
                  <Ticket key={imp.id} imp={imp} onEdit={() => setEditing(imp)} onToggle={() => toggle(imp)} onDelete={() => del(imp)} />
                ))
              )}
            </Stack>
          </div>

          <div>
            <UnstyledButton onClick={() => setShowClosed((v) => !v)}>
              <Text fw={600} size="sm" c="blue">{showClosed ? "▾" : "▸"} Closed tickets ({closed.length})</Text>
            </UnstyledButton>
            {showClosed && (
              <Stack gap="xs" mt="xs">
                {closed.length === 0 ? (
                  <Text size="sm" c="dimmed">No closed tickets.</Text>
                ) : (
                  closed.map((imp) => (
                    <Ticket key={imp.id} imp={imp} onEdit={() => setEditing(imp)} onToggle={() => toggle(imp)} onDelete={() => del(imp)} />
                  ))
                )}
              </Stack>
            )}
          </div>
        </>
      )}

      {(creating || editing) && (
        <ImprovementForm
          initial={editing ?? undefined}
          nextNumber={nextNumber}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={(row) => {
            upsertImprovementLocal(row)
            setCreating(false)
            setEditing(null)
          }}
          onError={setError}
        />
      )}
    </Stack>
  )
}

function ImprovementForm({
  initial,
  nextNumber,
  onClose,
  onSaved,
  onError,
}: {
  initial?: ImprovementRow
  nextNumber: number
  onClose: () => void
  onSaved: (row: ImprovementRow) => void
  onError: (e: string) => void
}) {
  const [title, setTitle] = useState(initial?.title ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "M")
  const [resolution, setResolution] = useState<Resolution>(initial?.resolution ?? "unresolved")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!title.trim()) {
      onError("A title is required.")
      return
    }
    setBusy(true)
    const desc = description.trim() || null
    const pri = priority
    const props: Record<string, unknown> = { description: desc, priority: pri, resolution }
    try {
      if (initial) {
        await omni.action(ACTIONS.updateImprovement, { node_id: initial.id, title: title.trim(), properties: props })
        onSaved({ ...initial, title: title.trim(), description: desc, priority: pri, resolution })
      } else {
        const created = (await omni.action(ACTIONS.createImprovement, {
          title: title.trim(),
          properties: { ...props, number: nextNumber, improvement_created_at: new Date().toISOString() },
        })) as ActionNode
        onSaved({ id: created.id, number: nextNumber, title: title.trim(), description: desc, priority: pri, resolution })
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened onClose={onClose} title={initial ? `Edit ticket ${ticketNo(initial.number)}` : "New ticket"} centered>
      <Stack gap="sm">
        <TextInput
          label="Title"
          required
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          data-autofocus
        />
        <LinkTextarea
          label="Description (optional)"
          autosize
          minRows={2}
          value={description}
          onChange={setDescription}
          description="Select text and press ⌘K / Ctrl+K to insert a link."
        />
        <Select
          label="Priority"
          required
          allowDeselect={false}
          data={[
            { value: "H", label: "High" },
            { value: "M", label: "Medium" },
            { value: "L", label: "Low" },
          ]}
          value={priority}
          onChange={(v) => setPriority((v as Priority) ?? "M")}
        />
        <Select
          label="Status"
          data={[
            { value: "unresolved", label: "Unresolved" },
            { value: "resolved", label: "Resolved" },
          ]}
          value={resolution}
          onChange={(v) => setResolution((v as Resolution) ?? "unresolved")}
        />
        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>Cancel</Button>
          <Button size="xs" onClick={submit} loading={busy}>{initial ? "Save" : "Create"}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
