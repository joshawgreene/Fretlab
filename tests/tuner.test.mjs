// Tuner accuracy + smoothness test. Run: node tests/tuner.test.mjs
// Feeds simulated guitar strings through the app's real analysis path (js/analysis.js)
// at the app's frame rate and checks what the needle would show.
import { analyseFrame, TUNER_FRAME } from '../js/analysis.js';
import { NoteTracker, TuneTracker } from '../js/tracker.js';

const SR = 48000;
const HOP = Math.round(SR / 45); // ~45 analyses per second, as in the app
const GATE = 0.04 * Math.pow(0.04, 0.55); // default sensitivity

/** Plucked-string-like tone: 8 decaying harmonics, slightly stretched (real strings are), plus noise. */
function string(f0At, seconds, { decay = 2.5, noise = 0.004, seed = 3 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const out = new Float32Array(Math.round(SR * seconds));
  const phase = new Float64Array(9);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR, f0 = f0At(t);
    let v = 0;
    for (let k = 1; k <= 8; k++) {
      phase[k] += (2 * Math.PI * f0 * k * Math.sqrt(1 + 0.0001 * k * k)) / SR;
      v += (Math.sin(phase[k]) * Math.exp((-t * k) / decay)) / k;
    }
    out[i] = 0.5 * v + rnd() * noise;
  }
  return out;
}

function needle(sig) {
  const notes = new NoteTracker(), tune = new TuneTracker();
  notes.gate = tune.gate = GATE;
  const rows = [];
  for (let st = 0; st + TUNER_FRAME <= sig.length; st += HOP) {
    const now = ((st + TUNER_FRAME) / SR) * 1000;
    const f = analyseFrame(sig.subarray(st, st + TUNER_FRAME), SR, { notes, tune }, now);
    rows.push({ t: now / 1000, m: f.tune.active ? f.tune.midi : null });
  }
  return rows;
}

function measure(rows, targetMidi, truthCents, from, to) {
  const r = rows.filter((o) => o.t >= from && o.t <= to);
  const shown = r.filter((o) => o.m !== null);
  const err = shown.map((o) => (o.m - targetMidi) * 100 - truthCents(o.t));
  const jumps = shown.slice(1).map((o, i) => Math.abs(o.m - shown[i].m) * 100);
  return {
    shown: shown.length / r.length,
    maxErr: Math.max(...err.map(Math.abs)),
    meanErr: err.reduce((a, b) => a + b, 0) / err.length,
    maxJump: Math.max(...jumps),
  };
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failed++;
}
const fmt = (m) => `max error ${m.maxErr.toFixed(2)}¢, mean ${m.meanErr.toFixed(2)}¢, biggest step ${m.maxJump.toFixed(2)}¢, shown ${(m.shown * 100).toFixed(0)}%`;

// 1. Low E 7 cents flat, left to ring for 8 s: steady and accurate all the way down the decay.
{
  const m = measure(needle(string(() => 82.407 * 2 ** (-7 / 1200), 8)), 40, () => -7, 0.4, 8);
  check('low E ringing out', m.maxErr < 2 && m.maxJump < 1 && m.shown === 1, fmt(m));
}
// 2. High E 4 cents sharp.
{
  const m = measure(needle(string(() => 329.63 * 2 ** (4 / 1200), 6, { decay: 1.8 })), 64, () => 4, 0.3, 6);
  check('high E', m.maxErr < 2 && m.maxJump < 1, fmt(m));
}
// 3. Turning the peg: A string glides from 30 cents flat up to pitch over 3 s. Needle must follow smoothly.
{
  const truth = (t) => -30 + Math.min(1, t / 3) * 30;
  const m = measure(needle(string((t) => 110 * 2 ** (truth(t) / 1200), 6, { decay: 6 })), 45, truth, 0.4, 6);
  check('peg turn follows smoothly', m.maxErr < 3 && m.maxJump < 2, fmt(m));
}
// 4. Switching strings: low E muted, then the A string (8 cents flat) is plucked.
{
  const a = string(() => 82.407, 6), b = string(() => 110 * 2 ** (-8 / 1200), 3.5, { decay: 2, seed: 9 });
  const mix = a.slice();
  for (let i = 120000; i < mix.length; i++) mix[i] *= Math.exp(-(i - 120000) / 600);
  for (let i = 0; i < b.length; i++) mix[i + 120000] += b[i] * 0.8;
  const rows = needle(mix);
  const sw = rows.find((o) => o.t > 2.5 && o.m !== null && Math.abs(o.m - 45) < 0.5);
  const later = measure(rows, 45, () => -8, 3, 5.5);
  check('switching strings', sw && sw.t - 2.5 < 0.25 && later.maxErr < 2,
    `switched after ${sw ? Math.round((sw.t - 2.5) * 1000) : '∞'} ms, then ${fmt(later)}`);
}

console.log(failed ? `${failed} failed` : 'All tuner tests passed');
process.exit(failed ? 1 : 0);
