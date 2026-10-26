import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// The browser only ever talks to this app's own origin (AI calls happen server-side). Restricting
// connect-src enforces that: it also blocks the usage-logging pings that the MediaPipe vision
// runtime tries to send to a Google endpoint, so webcam analysis stays fully on-device.
// In development, Next.js hot reload needs a WebSocket back to the dev server.
const connectSrc = isDev ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:*" : "connect-src 'self'";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          { key: "Content-Security-Policy", value: `${connectSrc}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` },
        ],
      },
    ];
  },
};

export default nextConfig;
