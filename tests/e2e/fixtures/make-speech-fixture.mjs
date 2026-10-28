// Builds tests/e2e/fixtures/speech-loop.wav: 2 s silence + one spoken sentence + 6 s silence (16 kHz mono).
// Chromium plays it on a loop as the fake microphone so Silero VAD has real speech to detect.
// Usage: node make-speech-fixture.mjs <input-speech.wav>   (input made with any TTS, e.g. Windows SAPI)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const input = readFileSync(process.argv[2]);
let offset = 12;
let data = null;
while (offset < input.length - 8) {
  const id = input.toString("ascii", offset, offset + 4);
  const size = input.readUInt32LE(offset + 4);
  if (id === "data") {
    data = input.subarray(offset + 8, offset + 8 + size);
    break;
  }
  offset += 8 + size;
}
if (!data) throw new Error("no data chunk");

const rate = 16000;
const silence = (sec) => Buffer.alloc(Math.round(sec * rate) * 2);
const pcm = Buffer.concat([silence(2), data, silence(6)]);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "speech-loop.wav");
writeFileSync(dest, Buffer.concat([header, pcm]));
console.log(`wrote ${dest} (${(data.length / 2 / rate).toFixed(1)} s of speech, ${(pcm.length / 2 / rate).toFixed(1)} s total)`);
