"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MeResponse } from "@phone-rep/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function Verify() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("Missing token.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await api(`/v1/auth/verify?token=${encodeURIComponent(token)}`, {}, MeResponse);
        await refresh();
        if (!cancelled) router.replace(me.consentedNoticeVersion ? "/" : "/consent");
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Sign-in failed.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, refresh, router]);

  return <div className="card max-w-md">{error ? <p className="error">{error}</p> : <p>Signing you in…</p>}</div>;
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Verify />
    </Suspense>
  );
}
