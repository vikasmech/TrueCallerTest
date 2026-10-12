"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { DataSourceRow, ImportBatchRow, type ImportMode } from "@phone-rep/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ImportsPage() {
  const [sources, setSources] = useState<DataSourceRow[]>([]);
  const [batches, setBatches] = useState<ImportBatchRow[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [mode, setMode] = useState<ImportMode>("source_observation");
  const [file, setFile] = useState<File | null>(null);
  const [idem, setIdem] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        api("/v1/admin/data-sources", {}, z.array(DataSourceRow)),
        api("/v1/admin/imports", {}, z.array(ImportBatchRow)),
      ]);
      setSources(s);
      setBatches(b);
      if (!sourceId && s[0]) setSourceId(s[0].id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Load failed.");
    }
  }, [sourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!batches.some((b) => b.state === "parsing" || b.state === "staged" || b.state === "committing")) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [batches, load]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("sourceId", sourceId);
      fd.set("idempotencyKey", idem);
      fd.set("mode", mode);
      fd.set("checksum", await sha256Hex(file));
      fd.set("file", file);
      await api("/v1/admin/imports", { formData: fd });
      setIdem(newIdempotencyKey());
      setFile(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "commit" | "rollback") {
    if (!confirm(`${action === "commit" ? "Commit" : "Roll back"} this batch?`)) return;
    setError(null);
    try {
      await api(`/v1/admin/imports/${id}/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    }
  }

  return (
    <RequireAuth min="admin">
      <div className="space-y-6">
        {error && <p className="error">{error}</p>}
        <form onSubmit={upload} className="card max-w-lg space-y-3 text-sm">
          <h1 className="text-lg font-semibold">Upload a CSV import</h1>
          <p className="text-slate-600">
            Columns: <code className="text-xs">phone_number,category,observed_at,external_record_id,source_score,source_score_scale,expires_at</code>. Up to 50,000 rows / 20 MB. The upload is staged privately and previewed; nothing is published until a reviewer commits.
          </p>
          <div>
            <label className="label">Data source</label>
            <select className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)} required>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.provider} ({s.reviewStatus})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Mode</label>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
              <option value="source_observation">Source observation seed (allegations with dates)</option>
              <option value="number_only">Number-only seed (no allegation, no score)</option>
              <option value="synthetic_test">Synthetic test seed (non-production only)</option>
            </select>
          </div>
          <div>
            <label className="label">CSV file</label>
            <input type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <button className="btn" disabled={busy || !file || !sourceId}>
            Upload and preview
          </button>
        </form>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Batches</h2>
          {batches.map((b) => (
            <div key={b.id} className="card space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{b.sourceProvider}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{b.mode.replace(/_/g, " ")}</span>
                <span className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white">{b.state.replace(/_/g, " ")}</span>
                {!b.publishable && b.mode !== "number_only" && <span className="text-xs text-amber-700">not publishable (source review / display rights / expiry)</span>}
                <span className="ml-auto font-mono text-xs text-slate-500">{b.id.slice(0, 8)} · {new Date(b.createdAt).toLocaleString()}</span>
              </div>
              {b.error && <p className="error">{b.error}</p>}
              <Counts c={b.rowCounts} />
              <div className="flex flex-wrap gap-2">
                {b.state === "previewed" && (
                  <button className="btn" onClick={() => void act(b.id, "commit")}>
                    Approve and commit
                  </button>
                )}
                {(b.state === "committed" || b.state === "commit_failed") && (
                  <button className="btn-danger" onClick={() => void act(b.id, "rollback")}>
                    Roll back batch
                  </button>
                )}
                {(b.rowCounts.invalid > 0 || b.rowCounts.duplicate > 0 || b.rowCounts.stale > 0 || b.rowCounts.excluded > 0) && (
                  <a className="btn-secondary" href={`/api/v1/admin/imports/${b.id}/errors?format=csv`}>
                    Download row errors (CSV)
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </RequireAuth>
  );
}

function Counts({ c }: { c: ImportBatchRow["rowCounts"] }) {
  const items: [string, number][] = [
    ["rows", c.total],
    ["valid", c.valid],
    ["invalid", c.invalid],
    ["duplicate", c.duplicate],
    ["stale", c.stale],
    ["excluded", c.excluded],
    ["new numbers", c.newNumbers],
    ["existing numbers", c.existingNumbers],
    ["new observations", c.newObservations],
    ["duplicate observations", c.duplicateObservations],
    ["processed", c.processed],
  ];
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs sm:grid-cols-6">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-slate-500">{k}</dt>
          <dd className="font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
