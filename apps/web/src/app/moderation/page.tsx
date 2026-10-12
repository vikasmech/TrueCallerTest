"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  AdminReportRow,
  DisputeSummary,
  type DisputeDecision,
  type ReportDecision,
  type ReportReasonCode,
  type ReportStatus,
} from "@phone-rep/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";

const REASONS: ReportReasonCode[] = [
  "verified_incident",
  "insufficient_detail",
  "duplicate",
  "wrong_category",
  "suspected_coordination",
  "demonstrably_false",
  "needs_review",
];

export default function ModerationPage() {
  const [status, setStatus] = useState<ReportStatus>("in_review");
  const [reports, setReports] = useState<AdminReportRow[]>([]);
  const [disputes, setDisputes] = useState<DisputeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([
        api(`/v1/admin/reports?status=${status}`, {}, z.array(AdminReportRow)),
        api("/v1/admin/disputes?status=open", {}, z.array(DisputeSummary)),
      ]);
      setReports(r);
      setDisputes(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Load failed.");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decideReport(id: string, decision: ReportDecision, reasonCode: ReportReasonCode, newCategory?: "fraud" | "spam") {
    try {
      await api(`/v1/admin/reports/${id}/decision`, { body: { decision, reasonCode, newCategory } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Decision failed.");
    }
  }

  async function decideDispute(id: string, decision: DisputeDecision) {
    if (!confirm(`Apply decision "${decision.replace(/_/g, " ")}"?`)) return;
    try {
      await api(`/v1/admin/disputes/${id}/decision`, { body: { decision } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Decision failed.");
    }
  }

  return (
    <RequireAuth min="moderator">
      <div className="space-y-6">
        {error && <p className="error">{error}</p>}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Reports</h1>
            <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as ReportStatus)}>
              <option value="in_review">In review</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          {reports.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing in this queue.</p>
          ) : (
            reports.map((r) => <ReportCard key={r.id} r={r} onDecide={decideReport} />)
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Open disputes</h2>
          {disputes.length === 0 ? (
            <p className="text-sm text-slate-600">No open disputes.</p>
          ) : (
            disputes.map((d) => (
              <div key={d.id} className="card space-y-2 text-sm">
                <div className="flex flex-wrap gap-4">
                  <span className="font-mono">{d.phoneNumberMasked}</span>
                  <span>{d.reason.replace(/_/g, " ")}</span>
                  <span className="text-slate-500">{new Date(d.createdAt).toLocaleString()}</span>
                </div>
                {d.details && <p className="whitespace-pre-wrap text-slate-700">{d.details}</p>}
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary" onClick={() => void decideDispute(d.id, "reject")}>
                    Reject
                  </button>
                  <button className="btn-secondary" onClick={() => void decideDispute(d.id, "uphold_correction")}>
                    Uphold (correction)
                  </button>
                  <button className="btn" onClick={() => void decideDispute(d.id, "uphold_reassignment")}>
                    Uphold (reassignment → new epoch)
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </RequireAuth>
  );
}

function ReportCard({
  r,
  onDecide,
}: {
  r: AdminReportRow;
  onDecide: (id: string, d: ReportDecision, reason: ReportReasonCode, newCategory?: "fraud" | "spam") => Promise<void>;
}) {
  const [reason, setReason] = useState<ReportReasonCode>(r.coordinationHold ? "suspected_coordination" : "verified_incident");
  return (
    <div className="card space-y-2 text-sm">
      <div className="flex flex-wrap gap-4">
        <span className="font-mono">{r.phoneNumberMasked}</span>
        <span>
          {r.category} · {r.channel}
        </span>
        <span>event {new Date(r.eventAt).toLocaleString()}</span>
        <span className="text-slate-500">reporter tier: {r.reporterTier}</span>
        {r.screeningReason && <span className="text-amber-700">screening: {r.screeningReason}</span>}
        {r.coordinationHold && <span className="font-medium text-red-700">coordination hold</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={reason} onChange={(e) => setReason(e.target.value as ReportReasonCode)}>
          {REASONS.map((x) => (
            <option key={x} value={x}>
              {x.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => void onDecide(r.id, "accept", reason)}>
          Accept
        </button>
        <button className="btn-secondary" onClick={() => void onDecide(r.id, "recategorize", "wrong_category", r.category === "fraud" ? "spam" : "fraud")}>
          Accept as {r.category === "fraud" ? "spam" : "fraud"}
        </button>
        <button className="btn-secondary" onClick={() => void onDecide(r.id, "hold", reason)}>
          Hold
        </button>
        <button className="btn-danger" onClick={() => void onDecide(r.id, "reject", reason)}>
          Reject
        </button>
      </div>
    </div>
  );
}
