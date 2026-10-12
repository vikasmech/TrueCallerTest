"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function Nav() {
  const { user, loading, logout } = useAuth();
  const isMod = user?.role === "moderator" || user?.role === "admin";
  const isAdmin = user?.role === "admin";
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-3xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
        <Link href="/" className="font-semibold">
          {process.env.NEXT_PUBLIC_APP_NAME ?? "Phone Reputation"}
        </Link>
        <Link href="/lookup">Look up</Link>
        <Link href="/report">Report</Link>
        {user && <Link href="/my-reports">My reports</Link>}
        {user && <Link href="/dispute">Dispute</Link>}
        {isMod && <Link href="/moderation">Moderation</Link>}
        {isAdmin && <Link href="/admin/sources">Sources</Link>}
        {isAdmin && <Link href="/admin/imports">Imports</Link>}
        <span className="ml-auto flex items-center gap-3 text-slate-600">
          {loading ? null : user ? (
            <>
              <span title={user.role}>{user.email}</span>
              <button className="underline" onClick={() => void logout()}>
                Sign out
              </button>
            </>
          ) : (
            <Link href="/sign-in" className="underline">
              Sign in
            </Link>
          )}
        </span>
      </nav>
    </header>
  );
}
