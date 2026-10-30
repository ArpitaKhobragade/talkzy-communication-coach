import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against PRODUCTION builds (`npm run build` first; `npm run test:e2e` does it).
// A production server has no hot reload, so tests cannot be disturbed by file-watcher reloads, and
// it is what students actually get. The same build is started twice with different environment
// variables: once with no keys (development mode) and once wired to local mock services.
const DEV_MODE_PORT = 3100; // app with no keys: scripted coach, browser voice
const CLOUD_PORT = 3102; // app with Groq/Sarvam/Cartesia pointed at the mocks
const MOCK_PORT = 3101;
const speechFixture = path.join(__dirname, "tests", "e2e", "fixtures", "speech-loop.wav");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      testIgnore: /cloud\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${DEV_MODE_PORT}` },
    },
    {
      name: "cloud",
      testMatch: /cloud\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${CLOUD_PORT}`,
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            // Real spoken audio, looped, as the fake microphone.
            `--use-file-for-fake-audio-capture=${speechFixture}`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: `npx next start -p ${DEV_MODE_PORT}`,
      url: `http://localhost:${DEV_MODE_PORT}/api/status`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // No keys, so tests never call a real AI or voice service.
      env: {
        ANTHROPIC_API_KEY: "",
        GROQ_API_KEY: "",
        SARVAM_API_KEY: "",
        CARTESIA_API_KEY: "",
        CARTESIA_VOICE_ID: "",
        LLM_PROVIDER: "",
        // The admin panel is open to this password only, and keeps its data in the server memory (no database in tests).
        ADMIN_PASSWORD: "e2e-admin-password",
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "",
        KV_REST_API_URL: "",
        KV_REST_API_TOKEN: "",
      },
    },
    {
      command: "node tests/e2e/mock-services.mjs",
      url: `http://localhost:${MOCK_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_PORT: String(MOCK_PORT) },
    },
    {
      command: `npx next start -p ${CLOUD_PORT}`,
      url: `http://localhost:${CLOUD_PORT}/api/status`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ANTHROPIC_API_KEY: "",
        LLM_PROVIDER: "",
        GROQ_API_KEY: "test-groq",
        GROQ_BASE_URL: `http://localhost:${MOCK_PORT}`,
        SARVAM_API_KEY: "test-sarvam",
        SARVAM_BASE_URL: `http://localhost:${MOCK_PORT}`,
        CARTESIA_API_KEY: "test-cartesia",
        CARTESIA_VOICE_ID: "test-voice-id",
        CARTESIA_BASE_URL: `http://localhost:${MOCK_PORT}`,
      },
    },
  ],
});
