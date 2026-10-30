import { expect, test } from "@playwright/test";
import { completeOnboarding } from "./helpers";

// Chromium's built-in fake camera (a moving test pattern, no person) lets us check that the
// on-device MediaPipe pipeline really loads its WASM + models and runs on live video frames
// without breaking the session. It does NOT validate accuracy on a real person's face/posture.
test.use({
  permissions: ["camera"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

test("camera analysis loads on-device models, runs, and puts the camera feedback in the report, and does not guess a look when no face is seen", async ({ page }) => {
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

  // The camera is always on: nothing to tick.
  await page.getByRole("button", { name: "Begin" }).click();

  await expect(page.getByText("Camera on · not recorded")).toBeVisible();
  await expect(page.getByText("Analysed on this device.").or(page.getByText("Face not in view. Try moving into the frame."))).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(6000); // let several frames be analysed
  await page.getByRole("button", { name: /start conversation/i }).click();

  await expect(page.getByRole("button", { name: "End session" })).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  await page.waitForURL(/\/report\//, { timeout: 60_000 });

  const camera = page.getByTestId("camera-box").locator("xpath=ancestor::section");
  await expect(camera).toBeVisible();
  // The test pattern contains no person, so the report says the face was out of the picture, and how to fix it.
  await expect(camera).toContainText(/Your face was often out of the picture/);
  await expect(camera).toContainText(/How to fix it: Sit so your whole face stays in the picture/);
  // With no face to read, it does not guess how the person looked.
  await expect(camera).not.toContainText(/nervous|angry|tense|relaxed/i);

  expect(pageErrors).toEqual([]);
  // Nothing left the device: no external request got a response. (MediaPipe's runtime tries to
  // send usage logs to a Google endpoint; our Content-Security-Policy must block that.)
  expect(externalResponses, `external requests that succeeded: ${externalResponses.join(", ")}`).toEqual([]);
  // Models and WASM were served from our own origin.
  expect(requests.some((u) => u.includes("/models/face_landmarker.task"))).toBe(true);
  expect(requests.some((u) => u.includes("/mediapipe/wasm/"))).toBe(true);
});
