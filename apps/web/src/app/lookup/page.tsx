"use client";

import { useState, type FormEvent } from "react";
import { LookupResponse } from "@phone-rep/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";
import { BAND_TEXT, LABEL_TEXT } from "@/lib/constants";

const TONE: Record<string, string> = {
  insufficient_reports: "border-slate-300 bg-slate-50",
  some_suspicious_reports: "border-amber-300 bg-amber-50",
  elevated_community_risk_signal: "border-orange-400 bg-orange-50",
  strong_community_risk_signal: "border-red-400 bg-red-50",
};

function Signal({ title, s }: { title: string; s: LookupResponse["fraud"] }) {
  return (
    <div className={`rounded-md border p-3 ${TONE[s.label] ?? ""}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div className="font-semibold">{LABEL_TEXT[s.label] ?? s.label}</div>
      {s.score !== null && (
        <div className="text-sm text-slate-700">
          Community report strength: <b>{s.score}</b>/100
          {s.support_band ? ` · ${BAND_TEXT[s.support_band] ?? s.support_band}` : ""}
        </div>
      )}
    </div>
  );
}

export default function LookupPage() {
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api("/v1/lookup", { body: { phoneNumber: phone } }, LookupResponse));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <form onSubmit={submit} className="card flex max-w-lg items-end gap-3">
          <div className="flex-1">
            <label className="label" htmlFor="phone">
              Exact phone number
            </label>
            <input id="phone" className="input" inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210" />
          </div>
          <button className="btn" disabled={busy}>
            Look up
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {result && (
          <div className="card space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Signal title="Suspected fraud" s={result.fraud} />
              <Signal title="Unwanted marketing / spam" s={result.spam} />
            </div>
            {result.external_signals.length > 0 && (
              <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm">
                <div className="font-semibold">Listed by an approved external source</div>
                <ul className="mt-1 list-disc pl-5">
                  {result.external_signals.map((s, i) => (
                    <li key={i}>
                      {s.source_name} · {s.category} · observed {new Date(s.observed_at).toLocaleDateString()}
                      {s.source_score !== null ? ` · provider score ${s.source_score} (${s.source_score_scale})` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-slate-600">This describes provenance, not verified fraud. It does not count toward the community score.</p>
              </div>
            )}
            {result.dispute_status === "open" && (
              <p className="notice">A correction or reassignment dispute is open for this number and has not yet been resolved.</p>
            )}
            <p className="text-xs text-slate-600">
              {result.warning}
              {result.computed_at ? ` Last updated ${new Date(result.computed_at).toLocaleString()}.` : " No community summary has been computed for this number."}{" "}
              Policy {result.policy_version}.
            </p>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
