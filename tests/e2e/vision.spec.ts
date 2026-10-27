import { expect, test } from "@playwright/test";
import { completeOnboarding, openFullReport } from "./helpers";

// Chromium's built-in fake camera (a moving test pattern, no person) lets us check that the
// on-device MediaPipe pipeline really loads its WASM + models and runs on live video frames
// without breaking the session. It does NOT validate accuracy on a real person's face/posture.
test.use({
  permissions: ["camera"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

test("camera analysis loads on-device models, runs, and reports observations without claiming emotion", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  const externalResponses: string[] = [];
  page.on("response", (r) => {
    const u = r.url();
    if (!u.startsWith("http://localhost:3100") && !u.startsWith("data:") && !u.startsWith("blob:")) externalResponses.push(u);
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();

  // Voice off (no mic in this test); camera on.
  await page.getByLabel(/Use my microphone/).uncheck();
  await page.getByLabel(/Use my camera/).check();
  await page.getByRole("button", { name: "Begin" }).click();

  await expect(page.getByText("Camera on · not recorded")).toBeVisible();
  await expect(page.getByText("Analysed on this device.").or(page.getByText("Face not in view. Try moving into the frame."))).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(6000); // let several frames be analysed
  await page.getByRole("button", { name: /finished reading/ }).click();

  await expect(page.getByText(/type your answers/i).first()).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  await page.waitForURL(/\/report\//, { timeout: 60_000 });

  await openFullReport(page);
  const body = page.getByRole("heading", { name: /3\. Camera/ }).locator("xpath=ancestor::section");
  await expect(body).toContainText(/What to fix/);
  await expect(body).toContainText(/How to fix it/);
  // Face and body topics are named in plain words, including the face while talking.
  await expect(body).toContainText(/Your face in the picture/);
  await expect(body).toContainText(/say nothing about how you feel/i);
  // The test pattern contains no person, so no face should be reported.
  await expect(body).toContainText(/out of view for 100% of the time/);
  await expect(body).toContainText(/What to fix/);
  await expect(body).toContainText(/How to fix it: Sit so your whole face stays in the picture/);

  expect(pageErrors).toEqual([]);
  // Nothing left the device: no external request got a response. (MediaPipe's runtime tries to
  // send usage logs to a Google endpoint; our Content-Security-Policy must block that.)
  expect(externalResponses, `external requests that succeeded: ${externalResponses.join(", ")}`).toEqual([]);
  // Models and WASM were served from our own origin.
  expect(requests.some((u) => u.includes("/models/face_landmarker.task"))).toBe(true);
  expect(requests.some((u) => u.includes("/mediapipe/wasm/"))).toBe(true);
});
