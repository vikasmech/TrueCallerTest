"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { DisputeSummary, type DisputeReason } from "@phone-rep/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";

export default function DisputePage() {
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState<DisputeReason>("not_me");
  const [details, setDetails] = useState("");
  const [rows, setRows] = useState<DisputeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setRows(await api("/v1/disputes/mine", {}, z.array(DisputeSummary)));
  }, []);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    try {
      await api("/v1/disputes", { body: { phoneNumber: phone, reason, details: details || undefined } });
      setDone(true);
      setPhone("");
      setDetails("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit dispute.");
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <form onSubmit={submit} className="card max-w-lg space-y-3">
          <h1 className="text-lg font-semibold">Request a correction or reassignment review</h1>
          <p className="text-sm text-slate-600">
            If you control a number and believe its reports are wrong or relate to a previous owner,
            file a dispute. While it is open, lookups show a dispute status; the score is not reduced
            automatically. Control of a number does not by itself erase earlier reports.
          </p>
          <div>
            <label className="label" htmlFor="phone">
              Phone number
            </label>
            <input id="phone" className="input" required inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="reason">
              Reason
            </label>
            <select id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value as DisputeReason)}>
              <option value="not_me">These communications were not from me (spoofing)</option>
              <option value="number_reassigned">The number was recently reassigned to me</option>
              <option value="false_reports">The reports are false or malicious</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="details">
              Details (optional, not shown publicly)
            </label>
            <textarea id="details" className="input" rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          {error && <p className="error">{error}</p>}
          {done && <p className="notice">Dispute submitted. A moderator will review it.</p>}
          <button className="btn">Submit dispute</button>
        </form>

        {rows.length > 0 && (
          <div className="card space-y-2">
            <h2 className="font-semibold">Your disputes</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-mono">{d.phoneNumberMasked}</span>
                  <span>{d.reason.replace("_", " ")}</span>
                  <span>
                    {d.status}
                    {d.decision ? ` · ${d.decision.replace(/_/g, " ")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
