import { useEffect, useMemo, useState } from "react";
import { fetchRuns, fetchRunSets } from "../api";
import type { Run, RunSet } from "../types";
import { noAssist } from "../uiHelpers";

interface Props {
  selected: string[];
  onChange: (ids: string[]) => void;
}

/** Filterable checkbox list of runs, used to attach existing runs to a node or run set. */
export default function RunPicker({ selected, onChange }: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [runSets, setRunSets] = useState<RunSet[]>([]);
  const [query, setQuery] = useState("");
  const [runSetId, setRunSetId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchRuns({ limit: 500 })
      .then((r) => setRuns(r.runs))
      .finally(() => setLoading(false));
    fetchRunSets().then(setRunSets).catch(() => setRunSets([]));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const setRunIds = runSetId
      ? new Set(runSets.find((v) => v.id === runSetId)?.runs.map((r) => r.id) ?? [])
      : null;
    return runs.filter((r) => {
      if (setRunIds && !setRunIds.has(r.id)) return false;
      if (!q) return true;
      return (
        r.display_name.toLowerCase().includes(q) ||
        r.environment.toLowerCase().includes(q) ||
        (r.user ?? "").toLowerCase().includes(q)
      );
    });
  }, [runs, query, runSetId, runSets]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const filteredIds = filtered.map((r) => r.id);
  const allShownSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.includes(id));

  const toggleAll = () => {
    if (allShownSelected) {
      onChange(selected.filter((id) => !filteredIds.includes(id)));
    } else {
      onChange(Array.from(new Set([...selected, ...filteredIds])));
    }
  };

  return (
    <div className="run-picker">
      <div className="run-picker-controls">
        <input
          {...noAssist}
          className="run-picker-search"
          placeholder="Filter runs by name, environment, or user…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={runSetId} onChange={(e) => setRunSetId(e.target.value)}>
          <option value="">All runs</option>
          {runSets.map((v) => (
            <option key={v.id} value={v.id}>
              Run set: {v.name} ({v.run_count})
            </option>
          ))}
        </select>
      </div>
      <div className="run-picker-meta">
        {loading ? "Loading runs…" : `${selected.length} selected · ${filtered.length} shown`}
        <button className="np-link-btn" onClick={toggleAll} disabled={filteredIds.length === 0}>
          {allShownSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="run-picker-list">
        {filtered.map((r) => (
          <label key={r.id} className="run-picker-row">
            <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
            <span className="run-picker-name">{r.display_name}</span>
            <span className="run-picker-env">{r.environment}</span>
            <span className="commit-sha">{r.commit ? r.commit.slice(0, 7) : "—"}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
