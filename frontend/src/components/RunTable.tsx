import { Fragment, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import type { Run } from "../types";

const col = createColumnHelper<Run>();

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function RunDetails({ run }: { run: Run }) {
  const meta: [string, string][] = [
    ["User", run.user ?? "—"],
    ["State", run.state ?? "—"],
    ["Project", run.project],
    ["Commit", run.commit ?? "—"],
  ];
  const entries = Object.entries(run.hyperparameters).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="run-details">
      <table className="hp-table">
        <tbody>
          {meta.map(([k, v]) => (
            <tr key={k}>
              <td className="hp-key">{k}</td>
              <td className="hp-val">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hp-heading">Hyperparameters</div>
      {entries.length === 0 ? (
        <em>No non-default hyperparameters recorded.</em>
      ) : (
        <table className="hp-table">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <td className="hp-key">{k}</td>
                <td className="hp-val">{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function RunTable({
  runs,
  onCreateRunSet,
}: {
  runs: Run[];
  onCreateRunSet: (runIds: string[]) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [showColMenu, setShowColMenu] = useState(false);

  const columns = useMemo(
    () => [
      col.display({
        id: "select",
        enableHiding: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
            aria-label="Select all runs on this page"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label="Select run"
          />
        ),
      }),
      col.display({
        id: "expander",
        enableHiding: false,
        header: "",
        cell: ({ row }) => (
          <button
            className="expander"
            onClick={() => setExpanded((e) => ({ ...e, [row.original.id]: !e[row.original.id] }))}
            aria-label="Toggle hyperparameters"
          >
            {expanded[row.original.id] ? "▾" : "▸"}
          </button>
        ),
      }),
      col.accessor("display_name", {
        id: "run",
        header: "Run",
        enableHiding: false,
        cell: (c) => (
          <a href={c.row.original.url} target="_blank" rel="noreferrer" className="run-link">
            {c.getValue()}
          </a>
        ),
      }),
      col.accessor("environment", { id: "environment", header: "Environment" }),
      col.accessor("user", { id: "user", header: "User", cell: (c) => c.getValue() ?? "—" }),
      col.accessor("project", { id: "project", header: "Project" }),
      col.accessor((r) => (r.commit ? r.commit.slice(0, 7) : "—"), {
        id: "commit",
        header: "Commit",
        cell: (c) => (
          <span className="commit-sha" title={c.row.original.commit ?? ""}>
            {c.getValue() as string}
          </span>
        ),
      }),
      col.accessor("batch_size", { id: "batch_size", header: "Batch size", cell: (c) => c.getValue() ?? "—" }),
      col.accessor("group_size", { id: "group_size", header: "Group size", cell: (c) => c.getValue() ?? "—" }),
      col.accessor("created_at", { id: "created_at", header: "Started", cell: (c) => fmtDate(c.getValue()) }),
    ],
    [expanded]
  );

  const table = useReactTable({
    data: runs,
    columns,
    getRowId: (r) => r.id,
    state: { sorting, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const hideableColumns = table.getAllLeafColumns().filter((c) => c.getCanHide());

  return (
    <div>
      <div className="table-toolbar">
        <div className="col-menu-wrap">
          <button className="clear" onClick={() => setShowColMenu((v) => !v)}>
            Columns ▾
          </button>
          {showColMenu && (
            <div className="col-menu" onMouseLeave={() => setShowColMenu(false)}>
              {hideableColumns.map((c) => (
                <label key={c.id} className="col-menu-item">
                  <input
                    type="checkbox"
                    checked={c.getIsVisible()}
                    onChange={c.getToggleVisibilityHandler()}
                  />
                  {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                </label>
              ))}
            </div>
          )}
        </div>
        <button
          className="primary"
          disabled={selectedIds.length === 0}
          onClick={() => onCreateRunSet(selectedIds)}
        >
          Create run set{selectedIds.length ? ` (${selectedIds.length})` : ""}
        </button>
      </div>

      <table className="run-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} onClick={h.column.getToggleSortingHandler()}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? ""}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <Fragment key={row.id}>
              <tr>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
              {expanded[row.original.id] && (
                <tr className="hp-row">
                  <td colSpan={row.getVisibleCells().length}>
                    <RunDetails run={row.original} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
