import { expect, test } from "@playwright/test";
import { completeOnboarding, completeTypedSession } from "./helpers";

// The admin password is set for the test server in playwright.config.ts.
const ADMIN_PASSWORD = "e2e-admin-password";

test("the admin data is closed to anyone who is not signed in", async ({ request }) => {
  expect((await request.get("/api/admin/students")).status()).toBe(401);
  expect((await request.get("/api/admin/report?studentId=abcdefgh&sessionId=s1")).status()).toBe(401);
  const wrong = await request.post("/api/admin/login", { data: { password: "not the password" } });
  expect(wrong.status()).toBe(401);
  // A student's device can send progress, but a made-up or oversized message is refused.
  expect((await request.post("/api/progress", { data: { studentId: "x", name: "", session: {}, report: [] } })).status()).toBe(400);
});

test("a finished session reaches the admin panel, which shows the student's name and downloads the report", async ({ page, browser }) => {
  await completeOnboarding(page, { name: "Meena Rao" });
  // The session is sent to the admin once it is finished.
  const sent = page.waitForResponse((r) => r.url().includes("/api/progress") && r.request().method() === "POST", { timeout: 120_000 });
  await completeTypedSession(page);
  expect((await sent).ok()).toBe(true);

  // The admin opens the panel on another device (a fresh browser with no student profile).
  const adminContext = await browser.newContext({ baseURL: page.url().split("/report")[0] });
  const admin = await adminContext.newPage();
  await admin.goto("/admin");
  await expect(admin.getByRole("heading", { name: "Admin panel" })).toBeVisible();
  await admin.getByLabel("Admin password").fill("wrong password here");
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin.getByText("That password is not right.")).toBeVisible();

  await admin.getByLabel("Admin password").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin.getByTestId("admin-ready")).toBeVisible();
  const row = admin.getByRole("row", { name: /Meena Rao/ }).first();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Open" }).click();
  await expect(admin.getByTestId("admin-sessions")).toBeVisible();
  const [pdf] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("button", { name: "Download report" }).first().click()]);
  expect(pdf.suggestedFilename()).toMatch(/^meena-rao-talkzy-report-\d{4}-\d{2}-\d{2}\.pdf$/);

  // Signing out closes the data again.
  await admin.getByRole("button", { name: "Sign out" }).click();
  await expect(admin.getByLabel("Admin password")).toBeVisible();
  expect((await adminContext.request.get("/api/admin/students")).status()).toBe(401);
  await adminContext.close();
});

test("a short session (one answer) also reaches the admin panel, marked as short", async ({ page, browser }) => {
  await completeOnboarding(page, { name: "Short Student" });
  const sent = page.waitForResponse((r) => r.url().includes("/api/progress") && r.request().method() === "POST", { timeout: 120_000 });
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await page.getByRole("button", { name: "Begin" }).click();
  await page.getByRole("button", { name: /start conversation/i }).click();
  await expect(page.getByText(/Your turn/)).toBeVisible({ timeout: 30_000 });
  const typing = page.getByLabel("Type your answer");
  if (!(await typing.isVisible())) await page.getByRole("button", { name: "Type instead" }).click();
  await typing.fill("A leader listens first to the team.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText(/Your turn/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  await page.waitForURL(/\/report\//, { timeout: 60_000 });
  expect((await sent).ok()).toBe(true);

  const adminContext = await browser.newContext({ baseURL: page.url().split("/report")[0] });
  const admin = await adminContext.newPage();
  await admin.goto("/admin");
  await admin.getByLabel("Admin password").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  const row = admin.getByRole("row", { name: /Short Student/ }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Open" }).click();
  await expect(admin.getByTestId("admin-sessions")).toContainText("short session");
  await adminContext.close();
});
