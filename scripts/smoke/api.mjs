import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { pass, waitFor, developmentLink } from "./helpers.mjs";

export async function runApiSmoke({ apiBase, apiLogPath, results }) {
  async function request(path, { cookie, body, method, form } = {}) {
    const response = await fetch(apiBase + path, {
      method: method ?? (body || form ? "POST" : "GET"),
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
  }
  async function login(email) {
    assert.equal((await request("/v1/auth/magic-link", { body: { email } })).status, 202);
    const link = await developmentLink(apiLogPath, email);
    const signed = await request("/v1/auth/verify" + new URL(link).search);
    assert.equal(signed.status, 200, JSON.stringify(signed.data));
    assert.ok(signed.cookie);
    return signed;
  }
  assert.equal((await request("/healthz")).status, 200);
  pass(results, "API health");
  assert.equal((await request("/v1/lookup", { body: { phoneNumber: "9000000001" } })).status, 401);
  pass(results, "Anonymous lookup denied");
  const admin = await login("admin@example.com");
  const user = await login(`smoke-${randomUUID()}@example.test`);
  assert.equal(admin.data.role, "admin");
  assert.equal(user.data.role, "user");
  const a = { cookie: admin.cookie }, u = { cookie: user.cookie };
  pass(results, "Development magic-link authentication and roles");
  assert.equal((await request("/v1/admin/data-sources", u)).status, 403);
  pass(results, "Regular user denied admin access");
  const reportBody = { idempotencyKey: randomUUID(), phoneNumber: "9800000011", channel: "call", category: "fraud", eventAt: new Date(Date.now() - 60000).toISOString() };
  assert.equal((await request("/v1/reports", { ...u, body: reportBody })).data.error, "CONSENT_REQUIRED");
  assert.equal((await request("/v1/consent", { ...u, body: { noticeVersion: "old" } })).status, 400);
  assert.equal((await request("/v1/consent", { ...u, body: { noticeVersion: "2026-10-v1" } })).status, 204);
  pass(results, "Current reporting consent enforced");
  const lookup = async (phoneNumber) => {
    const r = await request("/v1/lookup", { ...a, body: { phoneNumber } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const seeded = await lookup("9000000001");
  assert.ok(["elevated_community_risk_signal", "strong_community_risk_signal"].includes(seeded.fraud.label));
  assert.equal(seeded.spam.label, "insufficient_reports");
  assert.equal((await lookup("9000009999")).fraud.score, null);
  pass(results, "Seeded reputation, category separation and unknown lookup");
  const created = await request("/v1/reports", { ...u, body: reportBody });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const replay = await request("/v1/reports", { ...u, body: reportBody });
  assert.equal(replay.data.id, created.data.id);
  assert.equal((await request("/v1/reports", { ...u, body: { ...reportBody, idempotencyKey: randomUUID(), phoneNumber: "12345" } })).status, 400);
  assert.equal((await request("/v1/reports", { ...u, body: { ...reportBody, idempotencyKey: randomUUID(), eventAt: new Date(Date.now() + 86400000 * 365).toISOString() } })).status, 400);
  pass(results, "Reporting, idempotency and invalid-input rejection");
  assert.equal((await request(`/v1/admin/reports/${created.data.id}/decision`, { ...a, body: { decision: "accept", reasonCode: "verified_incident" } })).status, 204);
  const computed = await waitFor(async () => { const r = await lookup(reportBody.phoneNumber); return r.computed_at && r; }, "real worker recomputation");
  assert.equal(computed.fraud.label, "insufficient_reports");
  pass(results, "Moderation plus real pg-boss worker recomputation");
  const mine = await request("/v1/reports/mine", u);
  assert.ok(mine.data.some((r) => r.id === created.data.id && r.status === "accepted"));
  assert.equal((await request(`/v1/reports/${created.data.id}/withdraw`, { ...u, method: "POST" })).status, 204);
  pass(results, "My reports and withdrawal");
  const dispute = await request("/v1/disputes", { ...u, body: { phoneNumber: "9000000001", reason: "number_reassigned", details: "Synthetic test" } });
  assert.equal(dispute.status, 201, JSON.stringify(dispute.data));
  assert.equal((await lookup("9000000001")).dispute_status, "open");
  assert.equal((await request(`/v1/admin/disputes/${dispute.data.id}/decision`, { ...a, body: { decision: "uphold_reassignment" } })).status, 204);
  const after = await waitFor(async () => { const r = await lookup("9000000001"); return r.fraud.label === "insufficient_reports" && r; }, "reassignment recomputation");
  assert.equal(after.dispute_status, "none");
  pass(results, "Dispute resolution and reassignment reset through real worker");
  const source = await request("/v1/admin/data-sources", { ...a, body: { provider: "Synthetic Test Feed", provenanceGroupId: "verify-feed", permittedUse: "local test only", permissionReference: "SYNTHETIC", displayAllowed: true } });
  assert.equal(source.status, 201, JSON.stringify(source.data));
  assert.equal((await request(`/v1/admin/data-sources/${source.data.id}/review`, { ...a, body: { status: "approved" } })).status, 200);
  const observed = new Date(Date.now() - 86400000).toISOString();
  const csv = `phone_number,category,observed_at,external_record_id,source_score,source_score_scale,expires_at\n9000000021,fraud,${observed},r1,80,0-100,\n9000000021,fraud,${observed},r1,80,0-100,\n9000000022,spam,${observed},r2,,,\nbad,fraud,${observed},r3,,,\n`;
  const form = new FormData();
  form.set("sourceId", source.data.id);
  form.set("idempotencyKey", randomUUID());
  form.set("mode", "source_observation");
  form.set("checksum", createHash("sha256").update(csv).digest("hex"));
  form.set("file", new Blob([csv], { type: "text/csv" }), "synthetic.csv");
  const batch = await request("/v1/admin/imports", { ...a, form });
  assert.equal(batch.status, 202, JSON.stringify(batch.data));
  const batchState = async (wanted) => {
    const r = await request(`/v1/admin/imports/${batch.data.id}`, a);
    assert.equal(r.status, 200);
    if (["parse_failed", "commit_failed"].includes(r.data.state)) throw new Error(JSON.stringify(r.data));
    return r.data.state === wanted && r.data;
  };
  const preview = await waitFor(() => batchState("previewed"), "import parse");
  assert.equal(preview.rowCounts.valid, 2);
  assert.equal(preview.rowCounts.invalid, 1);
  assert.equal(preview.rowCounts.duplicate, 1);
  pass(results, "CSV upload, deduplication, validation and worker preview");
  assert.equal((await request(`/v1/admin/imports/${batch.data.id}/commit`, { ...a, method: "POST" })).status, 202);
  await waitFor(() => batchState("committed"), "import commit");
  const external = await lookup("9000000021");
  assert.equal(external.external_signals.length, 1);
  assert.equal(external.fraud.score, null);
  pass(results, "Imported signals stay separate from community score");
  assert.equal((await request(`/v1/admin/imports/${batch.data.id}/rollback`, { ...a, method: "POST" })).status, 202);
  await waitFor(async () => (await lookup("9000000021")).external_signals.length === 0, "import rollback");
  pass(results, "Worker import rollback");
  const loggedOut = await request("/v1/auth/logout", { ...u, method: "POST" });
  assert.equal(loggedOut.status, 204);
  assert.ok(loggedOut.cookie.startsWith("prs="));
  assert.equal((await request("/v1/auth/me", { cookie: loggedOut.cookie })).status, 401);
  pass(results, "Logout clears browser session cookie");
}
