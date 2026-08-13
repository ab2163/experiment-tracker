import { Fragment, useMemo, useState } from "react"
import {
  Group,
  Stack,
  Text,
  Button,
  Popover,
  Checkbox,
  TextInput,
  ScrollArea,
  Anchor,
  Menu,
  Table,
  Box,
  Modal,
} from "@mantine/core"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { useTracker, type RunRow, type RunSetRow } from "../lib/data"
import { omni, ACTIONS } from "../bridge"
import { ChevronUp, ChevronDown } from "../lib/icons"

const PAGE_SIZE = 100
const col = createColumnHelper<RunRow>()

// Per-column max widths (px); long values truncate with an ellipsis and the full
// value shows on hover (ticket #0001 — e.g. long environment names blowing out).
const COL_MAXW: Record<string, number> = {
  run: 240,
  environment: 180,
  user: 130,
  project: 200,
  commit: 90,
  batch_size: 90,
  group_size: 90,
  created_at: 130,
}

function fmtDate(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z")
  if (isNaN(d.getTime())) return iso
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const yy = String(d.getUTCFullYear()).slice(-2)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mi = String(d.getUTCMinutes()).padStart(2, "0")
  return `${dd}/${mm}/${yy} ${hh}:${mi}`
}

// Compact multi-select filter: trigger + scrollable checkbox list with counts.
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: { value: string; count: number }[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [query, setQuery] = useState("")
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => (o.value || "(none)").toLowerCase().includes(q)) : options

  return (
    <Popover position="bottom-start" shadow="md" width={280}>
      <Popover.Target>
        <Button variant="default" size="xs" w={240} justify="space-between" rightSection="▾">
          <Text size="xs" truncate>
            {selected.length === 0 ? `All ${label.toLowerCase()}s` : `${selected.length} selected`}
          </Text>
        </Button>
      </Popover.Target>
      <Popover.Dropdown p={6}>
        <TextInput
          size="xs"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          mb={6}
        />
        <ScrollArea.Autosize mah={240}>
          <Stack gap={2}>
            {shown.map((o) => (
              <Checkbox
                key={o.value}
                size="xs"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                label={
                  <Group gap={6} wrap="nowrap" justify="space-between" w={210}>
                    <Text size="xs" truncate title={o.value || "(none)"}>{o.value || "(none)"}</Text>
                    <Text size="xs" c="dimmed">{o.count}</Text>
                  </Group>
                }
              />
            ))}
            {shown.length === 0 && <Text size="xs" c="dimmed">No matches</Text>}
          </Stack>
        </ScrollArea.Autosize>
        {selected.length > 0 && (
          <Button variant="subtle" size="xs" mt={6} onClick={() => onChange([])}>
            Clear {label.toLowerCase()}
          </Button>
        )}
      </Popover.Dropdown>
    </Popover>
  )
}

function RunDetails({ run }: { run: RunRow }) {
  const meta: [string, string][] = [
    ["User", run.user ?? "—"],
    ["State", run.state ?? "—"],
    ["Project", run.project],
    ["Commit", run.commit ?? "—"],
  ]
  const entries = Object.entries(run.hyperparameters).sort(([a], [b]) => a.localeCompare(b))
  return (
    <Box p="sm" style={{ background: "var(--mantine-color-default-hover)" }}>
      <Table withRowBorders={false} styles={{ td: { padding: "2px 8px", fontSize: 12 } }}>
        <Table.Tbody>
          {meta.map(([k, v]) => (
            <Table.Tr key={k}>
              <Table.Td c="dimmed" w={160}>{k}</Table.Td>
              <Table.Td>{v}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fw={600} size="xs" mt="xs" mb={4}>Hyperparameters</Text>
      {entries.length === 0 ? (
        <Text size="xs" fs="italic" c="dimmed">No non-default hyperparameters recorded.</Text>
      ) : (
        <Table withRowBorders={false} styles={{ td: { padding: "2px 8px", fontSize: 12 } }}>
          <Table.Tbody>
            {entries.map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td c="dimmed" w={220}>{k}</Table.Td>
                <Table.Td>{typeof v === "object" ? JSON.stringify(v) : String(v)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Box>
  )
}

function genShortId(existing: Set<string>): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  for (let attempt = 0; attempt < 50; attempt++) {
    let id = ""
    for (let i = 0; i < 5; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (!existing.has(id)) return id
  }
  return Math.random().toString(36).slice(2, 7)
}

interface ActionNode {
  id: string
}

export function RunsTab() {
  const { data, addRunSetLocal } = useTracker()
  const allRuns = data!.runs
  const [creating, setCreating] = useState<string[] | null>(null)

  const [envs, setEnvs] = useState<string[]>([])
  const [projects, setProjects] = useState<string[]>([])
  const [users, setUsers] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(0)

  const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const inDate = (r: RunRow) => {
    if (!r.created_at) return !dateFrom && !dateTo
    const t = r.created_at.slice(0, 10)
    if (dateFrom && t < dateFrom) return false
    if (dateTo && t > dateTo) return false
    return true
  }

  // Cross-filtered facet counts: each facet reflects the *other* applied filters.
  const facet = (dim: "environment" | "project" | "user") => {
    const counts = new Map<string, number>()
    for (const r of allRuns) {
      if (dim !== "environment" && envs.length && !envs.includes(r.environment)) continue
      if (dim !== "project" && projects.length && !projects.includes(r.project)) continue
      if (dim !== "user" && users.length && !users.includes(r.user ?? "")) continue
      if (!inDate(r)) continue
      const key = dim === "user" ? r.user ?? "" : (r[dim] as string)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
  }
  const envOptions = useMemo(() => facet("environment"), [allRuns, projects, users, dateFrom, dateTo])
  const projectOptions = useMemo(() => facet("project"), [allRuns, envs, users, dateFrom, dateTo])
  const userOptions = useMemo(() => facet("user"), [allRuns, envs, projects, dateFrom, dateTo])

  const filtered = useMemo(
    () =>
      allRuns.filter((r) => {
        if (envs.length && !envs.includes(r.environment)) return false
        if (projects.length && !projects.includes(r.project)) return false
        if (users.length && !users.includes(r.user ?? "")) return false
        if (!inDate(r)) return false
        return true
      }),
    [allRuns, envs, projects, users, dateFrom, dateTo],
  )

  // Sort the WHOLE filtered set before paginating — otherwise the table would
  // only sort the current 100-row page and the globally-newest runs would be
  // stranded on a later page (they'd never surface on page 1).
  const sortedFiltered = useMemo(() => {
    const s = sorting[0]
    if (!s) return filtered
    const val = (r: RunRow): string | number | null => {
      switch (s.id) {
        case "run": return r.display_name
        case "environment": return r.environment
        case "user": return r.user
        case "project": return r.project
        case "commit": return r.commit
        case "batch_size": return r.batch_size
        case "group_size": return r.group_size
        case "created_at": return r.created_at
        default: return null
      }
    }
    const arr = [...filtered]
    arr.sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))
      return s.desc ? -cmp : cmp
    })
    return arr
  }, [filtered, sorting])

  const total = sortedFiltered.length
  const pageRuns = useMemo(() => sortedFiltered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sortedFiltered, page])

  const columns = useMemo(
    () => [
      col.display({
        id: "select",
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            size="xs"
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox size="xs" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
        ),
      }),
      col.display({
        id: "expander",
        enableHiding: false,
        header: "",
        cell: ({ row }) => (
          <span
            style={{ cursor: "pointer", userSelect: "none" }}
            onClick={() => setExpanded((e) => ({ ...e, [row.original.id]: !e[row.original.id] }))}
          >
            {expanded[row.original.id] ? "▾" : "▸"}
          </span>
        ),
      }),
      col.accessor("display_name", {
        id: "run",
        header: "Run",
        enableHiding: false,
        cell: (c) => (
          <Anchor href={c.row.original.url} target="_blank" rel="noreferrer" size="sm">
            {c.getValue()}
          </Anchor>
        ),
      }),
      col.accessor("environment", { id: "environment", header: "Environment" }),
      col.accessor("user", { id: "user", header: "User", cell: (c) => c.getValue() ?? "—" }),
      col.accessor("project", { id: "project", header: "Project" }),
      col.accessor((r) => (r.commit ? r.commit.slice(0, 7) : "—"), {
        id: "commit",
        header: "Commit",
        cell: (c) => (
          <Text size="sm" ff="monospace" title={c.row.original.commit ?? ""}>{c.getValue() as string}</Text>
        ),
      }),
      col.accessor("batch_size", { id: "batch_size", header: "Batch size", cell: (c) => c.getValue() ?? "—" }),
      col.accessor("group_size", { id: "group_size", header: "Group size", cell: (c) => c.getValue() ?? "—" }),
      col.accessor("created_at", { id: "created_at", header: "Started", cell: (c) => fmtDate(c.getValue()) }),
    ],
    [expanded],
  )

  const table = useReactTable({
    data: pageRuns,
    columns,
    getRowId: (r) => r.id,
    state: { sorting, rowSelection, columnVisibility },
    onSortingChange: (u) => { setSorting(u); setPage(0) },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide())
  const hasFilters = envs.length || projects.length || users.length || dateFrom || dateTo
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)
  const showPager = total > PAGE_SIZE

  const Pager = () =>
    showPager ? (
      <Group gap="sm" my="xs">
        <Button variant="default" size="xs" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          ← Prev
        </Button>
        <Text size="sm" c="dimmed">{from}–{to} of {total}</Text>
        <Button variant="default" size="xs" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
          Next →
        </Button>
      </Group>
    ) : null

  return (
    <Stack gap="sm" p="md">
      <Stack gap={6}>
        <Group gap="sm">
          <MultiSelectFilter label="Environment" options={envOptions} selected={envs} onChange={(v) => { setEnvs(v); setPage(0) }} />
          <MultiSelectFilter label="Project" options={projectOptions} selected={projects} onChange={(v) => { setProjects(v); setPage(0) }} />
        </Group>
        <Group gap="sm" align="flex-end">
          <MultiSelectFilter label="User" options={userOptions} selected={users} onChange={(v) => { setUsers(v); setPage(0) }} />
          <TextInput size="xs" label="From" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.currentTarget.value); setPage(0) }} />
          <TextInput size="xs" label="To" type="date" value={dateTo} onChange={(e) => { setDateTo(e.currentTarget.value); setPage(0) }} />
          {hasFilters ? (
            <Button variant="subtle" size="xs" onClick={() => { setEnvs([]); setProjects([]); setUsers([]); setDateFrom(""); setDateTo(""); setPage(0) }}>
              Clear filters
            </Button>
          ) : null}
        </Group>
      </Stack>

      <Group justify="space-between">
        <Menu shadow="md" closeOnItemClick={false}>
          <Menu.Target>
            <Button variant="default" size="xs">Columns ▾</Button>
          </Menu.Target>
          <Menu.Dropdown>
            {hideable.map((c) => (
              <Menu.Item key={c.id} onClick={() => c.toggleVisibility()}>
                <Checkbox
                  size="xs"
                  checked={c.getIsVisible()}
                  readOnly
                  label={typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                />
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        <Button size="xs" disabled={selectedIds.length === 0} onClick={() => setCreating(selectedIds)}>
          Create run set{selectedIds.length ? ` (${selectedIds.length})` : ""}
        </Button>
      </Group>

      <Pager />

      <Table.ScrollContainer minWidth={800}>
        <Table striped highlightOnHover withTableBorder stickyHeader>
          <Table.Thead>
            {table.getHeaderGroups().map((hg) => (
              <Table.Tr key={hg.id}>
                {hg.headers.map((h) => (
                  <Table.Th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    style={{ cursor: h.column.getCanSort() ? "pointer" : "default", whiteSpace: "nowrap" }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, verticalAlign: "middle" }}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{ asc: <ChevronUp size={13} />, desc: <ChevronDown size={13} /> }[h.column.getIsSorted() as string] ?? null}
                    </span>
                  </Table.Th>
                ))}
              </Table.Tr>
            ))}
          </Table.Thead>
          <Table.Tbody>
            {table.getRowModel().rows.map((row) => (
              <Fragment key={row.id}>
                <Table.Tr>
                  {row.getVisibleCells().map((cell) => {
                    const raw = cell.getValue()
                    const isText = cell.column.id !== "select" && cell.column.id !== "expander"
                    return (
                      <Table.Td
                        key={cell.id}
                        title={isText && raw != null ? String(raw) : undefined}
                        style={{ whiteSpace: "nowrap", maxWidth: COL_MAXW[cell.column.id] ?? 200, overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Table.Td>
                    )
                  })}
                </Table.Tr>
                {expanded[row.original.id] && (
                  <Table.Tr>
                    <Table.Td colSpan={row.getVisibleCells().length} p={0}>
                      <RunDetails run={row.original} />
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Pager />

      {creating && (
        <CreateRunSetModal
          runIds={creating}
          existingShortIds={new Set(data!.runSets.map((r) => r.short_id).filter(Boolean) as string[])}
          onClose={() => setCreating(null)}
          onCreated={(row) => {
            addRunSetLocal(row)
            setRowSelection({})
            setCreating(null)
          }}
        />
      )}
    </Stack>
  )
}

function CreateRunSetModal({
  runIds,
  existingShortIds,
  onClose,
  onCreated,
}: {
  runIds: string[]
  existingShortIds: Set<string>
  onClose: () => void
  onCreated: (row: RunSetRow) => void
}) {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) {
      setError("A run set name is required.")
      return
    }
    setBusy(true)
    setError(null)
    const short_id = genShortId(existingShortIds)
    try {
      const created = (await omni.action(ACTIONS.createRunSet, {
        title: name.trim(),
        properties: {
          name: name.trim(),
          short_id,
          rs_created_at: new Date().toISOString(),
          run_ids: runIds,
          visibility: "private",
          // Runs-tab creation lands at root (folder_id null), like the original.
        },
      })) as ActionNode
      onCreated({
        id: created.id,
        name: name.trim(),
        short_id,
        created_at: new Date().toISOString(),
        runIds,
        run_count: runIds.length,
        folder_id: null,
        visibility: "private",
        created_by: null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened onClose={onClose} title="Create run set" centered>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">{runIds.length} run{runIds.length === 1 ? "" : "s"} selected.</Text>
        <TextInput
          label="Run set name"
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
        />
        {error && <Text c="red" size="sm">{error}</Text>}
        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>Cancel</Button>
          <Button size="xs" onClick={submit} loading={busy}>Create run set</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
