"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { ReportSummary } from "@phone-rep/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";

export default function MyReportsPage() {
  const [rows, setRows] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api("/v1/reports/mine", {}, z.array(ReportSummary)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load reports.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function withdraw(id: string) {
    if (!confirm("Withdraw this report? Its contribution will be removed and scores recomputed.")) return;
    await api(`/v1/reports/${id}/withdraw`, { method: "POST" });
    await load();
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">My reports</h1>
        {error && <p className="error">{error}</p>}
        {rows === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-600">You have not submitted any reports.</p>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-2">Number</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Channel</th>
                  <th className="p-2">Event</th>
                  <th className="p-2">Status</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-2 font-mono">{r.phoneNumberMasked}</td>
                    <td className="p-2">{r.category}</td>
                    <td className="p-2">{r.channel}</td>
                    <td className="p-2">{new Date(r.eventAt).toLocaleString()}</td>
                    <td className="p-2">{r.status.replace("_", " ")}</td>
                    <td className="p-2 text-right">
                      {r.status !== "withdrawn" && (
                        <button className="btn-danger" onClick={() => void withdraw(r.id)}>
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
