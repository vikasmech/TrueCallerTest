"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NOTICE_VERSION } from "@/lib/constants";

export default function ConsentPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api("/v1/consent", { body: { noticeVersion: NOTICE_VERSION } });
      await refresh();
      router.replace("/report");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record consent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequireAuth>
      <div className="card space-y-4 text-sm text-slate-800">
        <h1 className="text-lg font-semibold">Reporting notice (version {NOTICE_VERSION})</h1>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            We store the phone number you report, the channel, category and the time of the
            communication, linked to your account. Numbers are stored encrypted and matched by a
            keyed hash.
          </li>
          <li>
            Your identity is never shown publicly. Lookups show only aggregate labels, coarse
            reporter-count bands and the time of the last update.
          </li>
          <li>
            Reports may be reviewed by moderators and can be rejected or held. You can withdraw a
            report at any time from “My reports”; its contribution is removed and scores recomputed.
          </li>
          <li>
            Report records are retained for 180 days under the pilot retention schedule, subject to
            legal review and narrow case holds.
          </li>
          <li>
            Only report numbers you have personally received communications from. Do not upload
            address books or call logs.
          </li>
        </ul>
        {error && <p className="error">{error}</p>}
        <button className="btn" onClick={() => void accept()} disabled={busy}>
          I understand and accept
        </button>
      </div>
    </RequireAuth>
  );
}
