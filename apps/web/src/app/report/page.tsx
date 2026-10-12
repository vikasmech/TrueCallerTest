"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CreateReportResponse } from "@phone-rep/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function localNowForInput() {
  const d = new Date();
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export default function ReportPage() {
  const { user } = useAuth();
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"call" | "sms">("call");
  const [category, setCategory] = useState<"fraud" | "spam">("fraud");
  const [eventAt, setEventAt] = useState(localNowForInput());
  const [idem, setIdem] = useState(newIdempotencyKey);
  const [result, setResult] = useState<CreateReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api(
        "/v1/reports",
        {
          body: {
            idempotencyKey: idem,
            phoneNumber: phone,
            channel,
            category,
            eventAt: new Date(eventAt).toISOString(),
          },
        },
        CreateReportResponse,
      );
      setResult(r);
      setIdem(newIdempotencyKey());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequireAuth>
      {user && !user.consentedNoticeVersion ? (
        <div className="card">
          <p className="mb-3 text-sm">Please review the reporting notice before submitting a report.</p>
          <Link href="/consent" className="btn">
            Review notice
          </Link>
        </div>
      ) : (
        <div className="card max-w-lg space-y-4">
          <h1 className="text-lg font-semibold">Report a suspicious call or message</h1>
          <p className="text-sm text-slate-600">
            Only report numbers that contacted you. Submission is not publication: reports are
            screened, may be held for review, and you can withdraw them later.
          </p>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label" htmlFor="phone">
                Caller / sender number
              </label>
              <input
                id="phone"
                className="input"
                required
                inputMode="tel"
                placeholder="e.g. 98765 43210 or +91…"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="channel">
                  Channel
                </label>
                <select id="channel" className="input" value={channel} onChange={(e) => setChannel(e.target.value as "call" | "sms")}>
                  <option value="call">Call</option>
                  <option value="sms">SMS</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="category">
                  Category
                </label>
                <select id="category" className="input" value={category} onChange={(e) => setCategory(e.target.value as "fraud" | "spam")}>
                  <option value="fraud">Suspected fraud</option>
                  <option value="spam">Unwanted marketing / spam</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="eventAt">
                When did it happen?
              </label>
              <input id="eventAt" type="datetime-local" className="input" required max={localNowForInput()} value={eventAt} onChange={(e) => setEventAt(e.target.value)} />
            </div>
            <p className="text-xs text-slate-500">
              Suspected fraud: impersonation, OTP/payment requests, phishing, fake jobs, investment
              scams. Spam: unsolicited promotions or persistent sales calls. A spam report never
              raises a fraud score.
            </p>
            {error && <p className="error">{error}</p>}
            <button className="btn" disabled={busy}>
              Submit report
            </button>
          </form>
          {result && (
            <div className="notice">
              Report <code>{result.id.slice(0, 8)}</code> recorded with status{" "}
              <b>{result.status.replace("_", " ")}</b>
              {result.replayed ? " (duplicate submission ignored)" : ""}. See{" "}
              <Link href="/my-reports" className="underline">
                My reports
              </Link>{" "}
              to withdraw.
            </div>
          )}
        </div>
      )}
    </RequireAuth>
  );
}
