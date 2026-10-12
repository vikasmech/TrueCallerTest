"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/v1/auth/magic-link", { body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card max-w-md space-y-4">
      <h1 className="text-lg font-semibold">Sign in</h1>
      {sent ? (
        <p className="notice">
          If that address is valid, a sign-in link has been sent. In development the link is printed
          to the API server console.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" disabled={busy}>
            Send sign-in link
          </button>
        </form>
      )}
    </div>
  );
}
