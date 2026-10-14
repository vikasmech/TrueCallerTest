import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pass, developmentLink } from "./helpers.mjs";
const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = requireWeb("playwright-core");

export async function runBrowserSmoke({ webBase, apiLogPath, results, outputDir }) {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    headless: true,
    // Root/container runners may need this opt-in. Do not disable sandboxing by default.
    args: process.env.SMOKE_CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], serverErrors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 500) serverErrors.push({ status: r.status(), path: new URL(r.url()).pathname }); });
  const text = (value) => page.getByText(value, { exact: false }).first().waitFor();
  async function signIn(email) {
    await page.goto(webBase + "/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    const sent = page.waitForResponse((r) => r.url().includes("/api/v1/auth/magic-link") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    assert.equal((await sent).status(), 202);
    await text("a sign-in link has been sent");
    const response = await page.goto(await developmentLink(apiLogPath, email));
    assert.equal(response.headers()["referrer-policy"], "no-referrer");
    assert.equal(response.headers()["cache-control"], "no-store");
    await page.waitForURL((url) => ["/", "/consent"].includes(url.pathname));
  }
  try {
    await page.goto(webBase);
    await page.getByRole("heading", { name: "Report and look up suspicious phone numbers" }).waitFor();
    pass(results, "Production-built homepage renders in Chromium");
    await page.goto(webBase + "/report");
    await text("You need to sign in to continue.");
    pass(results, "Anonymous browser is blocked from reporting");
    await signIn(`browser-${randomUUID()}@example.test`);
    await text("Reporting notice");
    await page.getByRole("button", { name: "I understand and accept" }).click();
    await page.waitForURL("**/report");
    await page.getByLabel("Caller / sender number", { exact: true }).fill("9800000012");
    const localTime = await page.evaluate(() => {
      const d = new Date(Date.now() - 120000);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    });
    await page.getByLabel("When did it happen?").fill(localTime);
    await page.getByRole("button", { name: "Submit report" }).click();
    await text("recorded with status");
    pass(results, "Browser sign-in, consent and report submission");
    await page.goto(webBase + "/my-reports");
    await page.getByRole("button", { name: "Withdraw", exact: true }).waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await page.getByRole("cell", { name: "withdrawn", exact: true }).waitFor();
    pass(results, "Browser report list and withdrawal");
    await page.goto(webBase + "/lookup");
    await page.getByLabel("Exact phone number").fill("9000000002");
    await page.getByRole("button", { name: "Look up", exact: true }).click();
    await text("Some suspicious reports");
    await page.screenshot({ path: join(outputDir, "lookup.png"), fullPage: true });
    pass(results, "Browser lookup renders aggregate reputation");
    await page.goto(webBase + "/moderation");
    await text("You do not have access to this page.");
    pass(results, "Browser regular-user admin restriction");
    await page.goto(webBase + "/dispute");
    await page.getByLabel("Phone number", { exact: true }).fill("9800000013");
    await page.getByLabel("Details", { exact: false }).fill("Synthetic browser validation only.");
    await page.getByRole("button", { name: "Submit dispute", exact: true }).click();
    await text("Dispute submitted.");
    pass(results, "Browser dispute form");
    await signIn("admin@example.com");
    await page.goto(webBase + "/moderation");
    await page.getByRole("heading", { name: "Open disputes", exact: true }).waitFor();
    const card = page.locator(".card").filter({ hasText: "Synthetic browser validation only." });
    await card.waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    const resolved = page.waitForResponse((r) => /\/api\/v1\/admin\/disputes\/[^/]+\/decision/.test(r.url()) && r.request().method() === "POST");
    await card.getByRole("button", { name: "Reject", exact: true }).click();
    assert.equal((await resolved).status(), 204);
    await card.waitFor({ state: "detached" });
    pass(results, "Admin browser moderation resolves dispute");
    for (const path of ["/admin/sources", "/admin/imports"]) {
      await page.goto(webBase + path);
      await text(path.endsWith("sources") ? "Register a data source" : "Upload a CSV import");
    }
    pass(results, "Admin sources and imports screens");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(webBase);
    await page.getByRole("heading", { name: "Report and look up suspicious phone numbers" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    pass(results, "Mobile homepage fits 390px viewport");
    assert.deepEqual(errors, []);
    assert.deepEqual(serverErrors, []);
    pass(results, "No uncaught browser errors or server 5xx responses");
  } catch (error) {
    await page.screenshot({ path: join(outputDir, "browser-failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}
