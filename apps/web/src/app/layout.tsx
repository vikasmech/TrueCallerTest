import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "Phone Reputation",
  description: "Community reports of suspicious calls and messages (private pilot).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <AuthProvider>
          <Nav />
          <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-3xl px-4 pb-8 text-xs text-slate-500">
            Scores are a community report strength index, not proof of fraud or caller identity.
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
