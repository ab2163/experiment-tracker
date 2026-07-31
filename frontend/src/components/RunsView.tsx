import { useEffect, useState } from "react";
import { createRunSet, fetchEnvironments, fetchProjects, fetchRuns, fetchUsers } from "../api";
import type { EnvironmentCount, ProjectCount, Run, UserCount } from "../types";
import { noAssist } from "../uiHelpers";
import RunTable from "./RunTable";
import SyncBar from "./SyncBar";

const PAGE_SIZE = 100;

interface Option {
  value: string;
  count: number;
}

/** Compact multi-select filter: a trigger button opening a scrollable checkbox
 *  list. Long option labels truncate with an ellipsis and show the full name on
 *  hover. Selecting multiple values ORs them within the dimension. */
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? options.filter((o) => (o.value || "(none)").toLowerCase().includes(q))
    : options;

  return (
    <div className="ms-filter">
      <span className="ms-label">{label}</span>
      <button className="ms-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="ms-trigger-text">
          {selected.length === 0 ? `All ${label.toLowerCase()}s` : `${selected.length} selected`}
        </span>
        <span className="ms-caret">▾</span>
      </button>
      {open && (
        <div className="ms-menu" onMouseLeave={() => setOpen(false)}>
          <input
            {...noAssist}
            className="ms-search"
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="ms-list">
            {shown.map((o) => (
              <label key={o.value} className="ms-item" title={o.value || "(none)"}>
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span className="ms-item-label">{o.value || "(none)"}</span>
                <span className="ms-item-count">{o.count}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="muted ms-empty">No matches</div>}
          </div>
          {selected.length > 0 && (
            <button className="clear ms-clear" onClick={() => onChange([])}>
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function RunsView({ runSetFolderId }: { runSetFolderId: string | null }) {
  const [envOptions, setEnvOptions] = useState<EnvironmentCount[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectCount[]>([]);
  const [userOptions, setUserOptions] = useState<UserCount[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [envs, setEnvs] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const [pendingRunSetIds, setPendingRunSetIds] = useState<string[] | null>(null);

  const df = dateFrom ? `${dateFrom}T00:00:00` : undefined;
  const dt = dateTo ? `${dateTo}T23:59:59` : undefined;

  // Cross-filtering: each facet's options reflect the *other* applied filters,
  // so only values with a non-zero run count remain selectable.
  useEffect(() => {
    fetchEnvironments({ project: projects, user: users, date_from: df, date_to: dt })
      .then(setEnvOptions)
      .catch((e) => setError(String(e)));
    fetchProjects({ environment: envs, user: users, date_from: df, date_to: dt })
      .then(setProjectOptions)
      .catch((e) => setError(String(e)));
    fetchUsers({ environment: envs, project: projects, date_from: df, date_to: dt })
      .then(setUserOptions)
      .catch((e) => setError(String(e)));
  }, [envs, projects, users, df, dt, reloadKey]);

  // Reset to first page whenever a filter changes.
  useEffect(() => {
    setPage(0);
  }, [envs, projects, users, dateFrom, dateTo]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchRuns({
      environment: envs,
      project: projects,
      user: users,
      date_from: df,
      date_to: dt,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((r) => {
        setRuns(r.runs);
        setTotal(r.total);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [envs, projects, users, df, dt, page, reloadKey]);

  const hasFilters = envs.length || projects.length || users.length || dateFrom || dateTo;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const showPager = total > PAGE_SIZE;

  const Pager = () =>
    showPager ? (
      <div className="pager">
        <button className="clear" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          ← Prev
        </button>
        <span className="count">
          {from}–{to} of {total}
        </span>
        <button className="clear" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
          Next →
        </button>
      </div>
    ) : null;

  return (
    <>
      <SyncBar onDataChanged={() => setReloadKey((k) => k + 1)} />

      <div className="filters run-filters">
        <div className="filter-row">
          <MultiSelectFilter
            label="Environment"
            options={envOptions.map((e) => ({ value: e.environment, count: e.count }))}
            selected={envs}
            onChange={setEnvs}
          />
          <MultiSelectFilter
            label="Project"
            options={projectOptions.map((p) => ({ value: p.project, count: p.count }))}
            selected={projects}
            onChange={setProjects}
          />
        </div>
        <div className="filter-row">
          <MultiSelectFilter
            label="User"
            options={userOptions.map((u) => ({ value: u.user ?? "", count: u.count }))}
            selected={users}
            onChange={setUsers}
          />
          <label>
            From
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {hasFilters && (
            <button
              className="clear"
              onClick={() => {
                setEnvs([]);
                setProjects([]);
                setUsers([]);
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <div className="count">Loading…</div>}

      <Pager />
      <RunTable runs={runs} onCreateRunSet={(ids) => setPendingRunSetIds(ids)} />
      <Pager />

      {pendingRunSetIds && (
        <CreateRunSetModal
          count={pendingRunSetIds.length}
          onClose={() => setPendingRunSetIds(null)}
          onCreate={async (name) => {
            await createRunSet({ name, run_ids: pendingRunSetIds, folder_id: runSetFolderId });
            setPendingRunSetIds(null);
          }}
        />
      )}
    </>
  );
}

function CreateRunSetModal({
  count,
  onClose,
  onCreate,
}: {
  count: number;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("A run set name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create run set</h3>
        <div className="count">{count} run{count === 1 ? "" : "s"} selected.</div>
        <label className="field">
          <span className="field-label">Run set name <span className="req">*</span></span>
          <input {...noAssist} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="clear" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create run set"}
          </button>
        </div>
      </div>
    </div>
  );
}
