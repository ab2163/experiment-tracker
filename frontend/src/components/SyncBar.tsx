import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSyncStatus, importDbFile, syncWandb } from "../api";
import type { SyncStatus } from "../types";

// "Sync to now" resumes from the newest stored run's timestamp. We back that
// watermark off by a few days so runs created *earlier* than the newest stored
// run but ingested late (or previously missed) still get picked up — ingestion
// is add-only, so re-scanning already-stored runs simply skips them.
const SYNC_LOOKBACK_DAYS = 3;

function startOfMonthLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-01T00:00:00`;
}

/** Subtract whole days from a naive-UTC ISO timestamp, returning the same
 *  tz-less "YYYY-MM-DDTHH:MM:SS" shape (stored run timestamps are naive UTC). */
function minusDaysUtc(iso: string, days: number): string {
  const d = new Date(`${iso}Z`); // force UTC interpretation of the naive string
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 19);
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "never (no runs stored yet)";
}

/** Data-loading toolbar: shows the latest stored run timestamp and offers three
 *  strictly add-only ways to grow the runs table (sync, WandB window, import .db). */
export default function SyncBar({ onDataChanged }: { onDataChanged: () => void }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await fetchSyncStatus());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const msg = await fn();
      setMessage(msg);
      await refreshStatus();
      onDataChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const syncFrom = (since: string) =>
    run(async () => {
      const r = await syncWandb({ since });
      return `Sync complete: added ${r.added} new, updated ${r.updated} in-progress, skipped ${r.skipped} (scanned ${r.scanned})${
        r.failed_projects ? ` — ⚠ ${r.failed_projects} project(s) failed to scan` : ""
      }.`;
    });

  const syncToNow = () => {
    // Sync from a few days before the latest stored run's timestamp up to now
    // (the lookback back-fills late/previously-missed runs). If nothing is
    // stored yet, ask for a start (default: start of this month) via a modal.
    const watermark = status?.last_run_created_at ?? null;
    if (!watermark) {
      setStartOpen(true);
      return;
    }
    return syncFrom(minusDaysUtc(watermark, SYNC_LOOKBACK_DAYS));
  };

  // All data-loading actions are disabled while busy or when live sync is off
  // (e.g. the seeded demo has no WANDB_API_KEY). Disabled buttons stay visible
  // but greyed so the capability is still discoverable.
  const actionsDisabled = busy || status?.sync_enabled === false;

  return (
    <div className="sync-wrap">
      <div className="sync-bar">
        <div className="sync-status">
          <span className="sync-label">Last synced</span>
          <span className="sync-value">{status ? fmt(status.last_run_created_at) : "…"}</span>
          {status && <span className="sync-count">{status.run_count} runs stored</span>}
        </div>
        <div className="sync-actions">
          {busy && <span className="sync-spinner" role="status" aria-label="Syncing" />}
          <button className="primary" onClick={syncToNow} disabled={actionsDisabled}>
            {busy ? "Working…" : "Sync to now"}
          </button>
          <button className="clear" onClick={() => setRangeOpen(true)} disabled={actionsDisabled}>
            Load from WandB
          </button>
          <button className="clear" onClick={() => setImportOpen(true)} disabled={actionsDisabled}>
            Import .db file
          </button>
          {status?.sync_enabled === false && (
            <span className="hint">Live WandB sync is disabled in this demo.</span>
          )}
        </div>
      </div>
      {message && <div className="count">{message}</div>}
      {error && <div className="error">{error}</div>}

      {rangeOpen && (
        <WandbRangeModal
          onClose={() => setRangeOpen(false)}
          onSubmit={(since, until) =>
            run(async () => {
              const r = await syncWandb({ since, until: until || undefined });
              setRangeOpen(false);
              return `Loaded WandB window: added ${r.added} new, updated ${r.updated} in-progress, skipped ${r.skipped} (scanned ${r.scanned})${
                r.failed_projects ? ` — ⚠ ${r.failed_projects} project(s) failed` : ""
              }.`;
            })
          }
        />
      )}

      {startOpen && (
        <StartTimestampModal
          onClose={() => setStartOpen(false)}
          onSubmit={(since) => {
            setStartOpen(false);
            void syncFrom(since);
          }}
        />
      )}

      {importOpen && (
        <ImportDbModal
          onClose={() => setImportOpen(false)}
          onSubmit={(file) =>
            run(async () => {
              const r = await importDbFile(file);
              setImportOpen(false);
              return `Imported ${file.name}: added ${r.added} new run(s), skipped ${r.skipped} already stored (source had ${r.source_runs}).`;
            })
          }
        />
      )}
    </div>
  );
}

function StartTimestampModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (since: string) => void;
}) {
  const [since, setSince] = useState(startOfMonthLocal().slice(0, 16));
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Sync from…</h3>
        <div className="hint">No runs stored yet — choose a start timestamp to sync from (up to now).</div>
        <label className="field">
          <span className="field-label">From <span className="req">*</span></span>
          <input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} autoFocus />
        </label>
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button className="clear" onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => (since ? onSubmit(since) : setErr("A start timestamp is required."))}
          >
            Sync
          </button>
        </div>
      </div>
    </div>
  );
}

function WandbRangeModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (since: string, until: string) => void;
}) {
  const [since, setSince] = useState(startOfMonthLocal().slice(0, 16));
  const [until, setUntil] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    if (!since) {
      setErr("A start timestamp is required.");
      return;
    }
    if (until && until < since) {
      setErr("End must be on or after start.");
      return;
    }
    onSubmit(since, until);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Load from WandB (date range)</h3>
        <label className="field">
          <span className="field-label">From <span className="req">*</span></span>
          <input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">To (optional — defaults to now)</span>
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button className="clear" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit}>Load runs</button>
        </div>
      </div>
    </div>
  );
}

function ImportDbModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!file) {
      setErr("Choose a .db file to import.");
      return;
    }
    onSubmit(file);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import runs from a .db file</h3>
        <label className="field">
          <span className="field-label">.db file <span className="req">*</span></span>
          <input
            ref={inputRef}
            type="file"
            accept=".db,.sqlite,.sqlite3,application/octet-stream"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button className="clear" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit}>Import</button>
        </div>
      </div>
    </div>
  );
}
