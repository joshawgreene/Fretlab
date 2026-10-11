// Detector regression test. Run: node tests/pitch.test.mjs
// Uses Karplus–Strong plucked strings (a decent synthetic guitar) from C2 to E6.
import { detectPitch, rms } from '../js/pitch.js';
import { freqToMidi, midiToFreq, parseNote } from '../js/notes.js';
import { CLARITY_GATE } from '../js/tracker.js';

const SR = 48000;
const NOISE = 0.02;

function pluck(freq, seconds, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const N = Math.round(SR / freq);
  const out = new Float32Array(Math.round(SR * seconds));
  const line = Float32Array.from({ length: N }, rnd);
  for (let i = 0, p = 0; i < out.length; i++) {
    const a = line[p], b = line[(p + 1) % N];
    line[p] = 0.996 * 0.5 * (a + b);
    out[i] = a;
    p = (p + 1) % N;
  }
  return out;
}

let confident = 0, confidentWrong = 0, audible = 0, missed = 0;
for (let m = parseNote('C2'); m <= parseNote('E6'); m++) {
  const clean = pluck(midiToFreq(m), 1.5, m + 7);
  const sig = clean.map((v) => v + (Math.random() * 2 - 1) * NOISE);
  for (let t = 0.05; t < 1.4; t += 0.05) {
    const st = Math.round(t * SR);
    const frame = sig.subarray(st, st + 4096);
    const snr = rms(clean.subarray(st, st + 4096)) / (NOISE / Math.sqrt(3));
    const r = detectPitch(frame, SR);
    const correct = r && Math.abs(freqToMidi(r.freq) - m) < 0.4;
    const passes = r && r.clarity >= CLARITY_GATE;
    if (snr > 4) { audible++; if (!(passes && correct)) missed++; }
    if (passes) { confident++; if (!correct) confidentWrong++; }
  }
}

let sineWorst = 0;
for (const f of [65.41, 82.41, 110, 146.83, 196, 246.94, 329.63, 440, 1000, 1318.5]) {
  const buf = Float32Array.from({ length: 4096 }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR));
  sineWorst = Math.max(sineWorst, Math.abs(1200 * Math.log2(detectPitch(buf, SR).freq / f)));
}

const wrongRate = confidentWrong / confident;
const missRate = missed / audible;
console.log(`confident frames: ${confident}, wrong: ${confidentWrong} (${(wrongRate * 100).toFixed(2)}%)`);
console.log(`audible frames: ${audible}, missed: ${missed} (${(missRate * 100).toFixed(2)}%)`);
console.log(`sine accuracy (tuner precision): worst ${sineWorst.toFixed(2)} cents`);

const ok = wrongRate < 0.01 && missRate < 0.03 && sineWorst < 1;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
