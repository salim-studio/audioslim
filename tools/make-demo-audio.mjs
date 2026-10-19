// Generates a short piece of demo audio for the README screenshot.
// Run: node tools/make-demo-audio.mjs .dev-media/demo.wav
import fs from 'node:fs';
import path from 'node:path';
import { encodeWav } from '../src/audio/wav.js';

const RATE = 48000;
const out = process.argv[2] || '.dev-media/demo.wav';

const NOTES = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23];

function makeTrack(seconds) {
  const n = Math.round(RATE * seconds);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const beat = 0.42;

  // A plucked arpeggio, panned slightly across the stereo field.
  let t = 0.0;
  let i = 0;
  while (t < seconds - 0.3) {
    const freq = NOTES[i % NOTES.length];
    const dur = 0.55;
    const start = Math.round(t * RATE);
    const len = Math.round(dur * RATE);
    const pan = ((i % 4) - 1.5) / 3;
    for (let k = 0; k < len && start + k < n; k++) {
      const tt = k / RATE;
      const env = Math.exp(-tt * 4.2) * (1 - Math.exp(-tt * 320));
      const s =
        Math.sin(2 * Math.PI * freq * tt) * 0.6 +
        Math.sin(2 * Math.PI * freq * 2 * tt) * 0.22 +
        Math.sin(2 * Math.PI * freq * 3 * tt) * 0.1;
      const v = s * env * 0.42;
      l[start + k] += v * (1 - Math.max(0, pan) * 0.5);
      r[start + k] += v * (1 + Math.min(0, pan) * 0.5);
    }
    t += beat;
    i++;
  }

  // A bass note under it, so the low end moves.
  for (let k = 0; k < n; k++) {
    const tt = k / RATE;
    const bar = Math.floor(tt / 2) % 2;
    const f = bar ? 98 : 73.42;
    const env = 0.5 + 0.5 * Math.sin(Math.PI * ((tt % 2) / 2));
    const s = Math.sin(2 * Math.PI * f * tt) * 0.18 * env;
    l[k] += s;
    r[k] += s;
  }

  // A touch of room noise, so the waveform is not perfectly clean.
  for (let k = 0; k < n; k++) l[k] += (Math.random() - 0.5) * 0.004;
  for (let k = 0; k < n; k++) r[k] += (Math.random() - 0.5) * 0.004;

  return [l, r];
}

const seconds = 9.6;
const [l, r] = makeTrack(seconds);
const blob = encodeWav({ sampleRate: RATE, channels: [l, r], bitDepth: 16 });
const buf = Buffer.from(await blob.arrayBuffer());
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log(`${out}: ${buf.length} bytes, ${seconds}s`);
