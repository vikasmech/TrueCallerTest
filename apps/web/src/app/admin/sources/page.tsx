"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { DataSourceRow } from "@phone-rep/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";

export default function SourcesPage() {
  const [rows, setRows] = useState<DataSourceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    provider: "",
    provenanceGroupId: "",
    upstreamProvenance: "",
    permittedUse: "",
    permissionReference: "",
    displayAllowed: false,
    validUntil: "",
  });

  const load = useCallback(async () => {
    try {
      setRows(await api("/v1/admin/data-sources", {}, z.array(DataSourceRow)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Load failed.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/v1/admin/data-sources", {
        body: {
          ...form,
          upstreamProvenance: form.upstreamProvenance || undefined,
          validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
        },
      });
      setForm({ provider: "", provenanceGroupId: "", upstreamProvenance: "", permittedUse: "", permissionReference: "", displayAllowed: false, validUntil: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed.");
    }
  }

  async function review(id: string, status: "approved" | "rejected") {
    try {
      await api(`/v1/admin/data-sources/${id}/review`, { body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Review failed.");
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  return (
    <RequireAuth min="admin">
      <div className="space-y-6">
        {error && <p className="error">{error}</p>}
        <form onSubmit={submit} className="card max-w-lg space-y-3 text-sm">
          <h1 className="text-lg font-semibold">Register a data source</h1>
          <p className="text-slate-600">Sources must be reviewed and approved before their observations can be committed. Vendors reselling the same upstream feed share a provenance group.</p>
          <div>
            <label className="label">Provider name</label>
            <input className="input" required value={form.provider} onChange={set("provider")} />
          </div>
          <div>
            <label className="label">Provenance group ID</label>
            <input className="input" required value={form.provenanceGroupId} onChange={set("provenanceGroupId")} placeholder="e.g. upstream-feed-x" />
          </div>
          <div>
            <label className="label">Original upstream provenance (optional)</label>
            <input className="input" value={form.upstreamProvenance} onChange={set("upstreamProvenance")} />
          </div>
          <div>
            <label className="label">Permitted use</label>
            <textarea className="input" required rows={2} value={form.permittedUse} onChange={set("permittedUse")} />
          </div>
          <div>
            <label className="label">License / permission reference</label>
            <input className="input" required value={form.permissionReference} onChange={set("permissionReference")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.displayAllowed} onChange={set("displayAllowed")} /> Public display allowed
            </label>
            <div>
              <label className="label">Valid until (optional)</label>
              <input type="date" className="input" value={form.validUntil} onChange={set("validUntil")} />
            </div>
          </div>
          <button className="btn">Register</button>
        </form>

        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-2">Provider</th>
                <th className="p-2">Group</th>
                <th className="p-2">Display</th>
                <th className="p-2">Status</th>
                <th className="p-2">Valid until</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="p-2">
                    {s.provider}
                    <div className="font-mono text-xs text-slate-500">{s.id}</div>
                  </td>
                  <td className="p-2">{s.provenanceGroupId}</td>
                  <td className="p-2">{s.displayAllowed ? "yes" : "no"}</td>
                  <td className="p-2">{s.reviewStatus}</td>
                  <td className="p-2">{s.validUntil ? new Date(s.validUntil).toLocaleDateString() : "—"}</td>
                  <td className="p-2 text-right">
                    {s.reviewStatus === "pending" && (
                      <span className="flex justify-end gap-2">
                        <button className="btn" onClick={() => void review(s.id, "approved")}>
                          Approve
                        </button>
                        <button className="btn-danger" onClick={() => void review(s.id, "rejected")}>
                          Reject
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </RequireAuth>
  );
}
