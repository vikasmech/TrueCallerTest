import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; formData?: FormData };

export async function api<T = void>(
  path: string,
  opts: Opts = {},
  schema?: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body || opts.formData ? "POST" : "GET"),
    credentials: "same-origin",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.formData ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, json?.error ?? "ERROR", json?.message ?? res.statusText);
  }
  return schema ? schema.parse(json) : (json as T);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
