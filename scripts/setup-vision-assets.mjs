// Copies the MediaPipe WASM runtime from node_modules and downloads the two pretrained
// models into /public so that webcam analysis runs fully on-device (no CDN at runtime).
// Safe to run repeatedly. Failure is non-fatal: the app works without vision analysis.
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const wasmSrc = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDest = path.join(root, "public", "mediapipe", "wasm");
const modelsDest = path.join(root, "public", "models");

const MODELS = [
  {
    file: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  },
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  },
];

// Silero voice-activity detection (runs in the browser). Served from /public/vad so no CDN is used.
const vadDest = path.join(root, "public", "vad");
const VAD_FILES = [
  ["node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx", "silero_vad_v5.onnx"],
  ["node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js", "vad.worklet.bundle.min.js"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.mjs"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.wasm"],
];

async function copyVadAssets() {
  await mkdir(vadDest, { recursive: true });
  let copied = 0;
  for (const [from, to] of VAD_FILES) {
    const src = path.join(root, from);
    if (!existsSync(src)) {
      console.warn(`[vad] missing ${from}; cloud voice activity detection will be unavailable`);
      continue;
    }
    await cp(src, path.join(vadDest, to));
    copied++;
  }
  console.log(`[vad] copied ${copied}/${VAD_FILES.length} voice-activity assets`);
}

async function main() {
  await copyVadAssets();
  if (existsSync(wasmSrc)) {
    await mkdir(wasmDest, { recursive: true });
    await cp(wasmSrc, wasmDest, { recursive: true });
    console.log("[vision] copied MediaPipe WASM runtime");
  } else {
    console.warn("[vision] @mediapipe/tasks-vision not installed; skipping WASM copy");
  }

  await mkdir(modelsDest, { recursive: true });
  for (const m of MODELS) {
    const dest = path.join(modelsDest, m.file);
    if (existsSync(dest) && (await stat(dest)).size > 100_000) {
      console.log(`[vision] ${m.file} already present`);
      continue;
    }
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      console.log(`[vision] downloaded ${m.file}`);
    } catch (err) {
      console.warn(`[vision] could not download ${m.file}: ${err.message}. Body-language analysis will be unavailable.`);
    }
  }
}

main().catch((err) => {
  console.warn("[vision] setup skipped:", err.message);
});
