import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", ".next-cloud/**", "node_modules/**", "public/mediapipe/**", "public/models/**", "public/vad/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
];

export default config;
