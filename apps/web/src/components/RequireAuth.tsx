"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import type { Role } from "@phone-rep/shared";

const RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

export function RequireAuth({ min = "user", children }: { min?: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="card">
        <p className="mb-3">You need to sign in to continue.</p>
        <Link href="/sign-in" className="btn">
          Sign in
        </Link>
      </div>
    );
  }
  if (RANK[user.role] < RANK[min]) return <p className="error">You do not have access to this page.</p>;
  return <>{children}</>;
}
