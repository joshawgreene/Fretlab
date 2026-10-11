// Low-string note detection test. Run: node tests/lowstrings.test.mjs
// Simulates low guitar notes the way a laptop or phone mic hears them — weak fundamental,
// pick attack, mains hum, room echo, the previous string left ringing — and scores what the
// live fretboard would show, through the app's real analysis path.
import { analyseFrame, NOTE_FRAME } from '../js/analysis.js';
import { NoteTracker } from '../js/tracker.js';
import { midiToFreq } from '../js/notes.js';
const SR = 48000;
const HOP = Math.round(SR / 45);

function guitarNote(midi, seconds, { seed = 1, hpHz = 150, pluckPos = 1 / 7, B = 0.00015, hum = 0.004, noise = 0.004, level = 0.5 } = {}) {
  let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const f0 = midiToFreq(midi) * 2 ** ((rnd() * 4) / 1200);
  const n = Math.round(SR * seconds), out = new Float32Array(n);
  const H = 16, amp = [], fk = [], dk = [];
  for (let k = 1; k <= H; k++) {
    const f = f0 * k * Math.sqrt(1 + B * k * k);
    if (f > SR / 2.2) break;
    amp.push(Math.abs(Math.sin(Math.PI * k * pluckPos)) / k); fk.push(f); dk.push(0.6 + 0.35 * k);
  }
  const ph = fk.map(() => rnd() * Math.PI);
  for (let i = 0; i < n; i++) {
    const t = i / SR; let v = 0;
    for (let j = 0; j < fk.length; j++) v += amp[j] * Math.exp(-t * dk[j] / 1.5) * Math.sin(ph[j] + 2 * Math.PI * fk[j] * t);
    const attack = t < 0.02 ? rnd() * 0.6 * (1 - t / 0.02) : 0;
    out[i] = level * (v + attack) + hum * Math.sin(2 * Math.PI * 50 * t) + noise * rnd();
  }
  // mic/body high-pass (2nd order) — small mics lose the low fundamental
  if (hpHz) {
    const w = 2 * Math.PI * hpHz / SR, cs = Math.cos(w), al = Math.sin(w) / Math.SQRT2;
    const b0 = (1 + cs) / 2 / (1 + al), b1 = -(1 + cs) / (1 + al), a1 = -2 * cs / (1 + al), a2 = (1 - al) / (1 + al);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { const x = out[i], y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y; }
  }
  return out;
}
function reverb(x, mix = 0.25) { // a few diffuse echoes
  const y = x.slice(); const taps = [[0.023, 0.5], [0.037, 0.4], [0.051, 0.33], [0.071, 0.27], [0.097, 0.2], [0.131, 0.15]];
  for (const [d, g] of taps) { const D = Math.round(d * SR); for (let i = D; i < x.length; i++) y[i] += mix * g * y[i - D] * 0.6; }
  return y;
}
function scoreHard(midis, { dur = 1.5, ring = 0.35, opts = {}, frameFn = analyseFrame, verbose = false } = {}) {
  const n = Math.round(SR * dur * midis.length) + NOTE_FRAME; let sig = new Float32Array(n);
  midis.forEach((m, i) => { const p = guitarNote(m, dur * 2.5, { ...opts, seed: i + 7 }); const off = Math.round(i * dur * SR);
    for (let j = 0; j < p.length && off + j < n; j++) sig[off + j] += p[j] * (j > dur * SR ? ring : 1); }); // previous note keeps ringing quieter
  sig = reverb(sig);
  const notes = new NoteTracker(); notes.gate = 0.04 * Math.pow(0.04, 0.55);
  let right = 0, wrong = 0, blank = 0, octave = 0; const lat = []; const firsts = midis.map(() => null); const errs = [];
  for (let st = 0; st + NOTE_FRAME <= n; st += HOP) {
    const tEnd = (st + NOTE_FRAME) / SR, idx = Math.floor((tEnd - 1e-4) / dur); if (idx >= midis.length) break;
    const f = frameFn(sig.subarray(st, st + NOTE_FRAME), SR, { notes }, tEnd * 1000);
    const since = tEnd - idx * dur, truth = midis[idx];
    if (f.active && f.midi === truth && firsts[idx] === null) firsts[idx] = since;
    if (since < 0.2) continue;
    if (!f.active) blank++; else if (f.midi === truth) right++; else { wrong++; if ((f.midi - truth) % 12 === 0) octave++; if (verbose) errs.push(`${truth}->${f.midi}@${since.toFixed(2)}`); }
  }
  const tot = right + wrong + blank, ok = firsts.filter(x => x !== null);
  return { right: +(100 * right / tot).toFixed(1), wrong: +(100 * wrong / tot).toFixed(1), octave: +(100 * octave / tot).toFixed(1), blank: +(100 * blank / tot).toFixed(1),
    react_ms: Math.round(1000 * ok.reduce((a, b) => a + b, 0) / (ok.length || 1)), missed: firsts.filter(x => x === null).length, ...(verbose ? { errs: errs.slice(0, 12) } : {}) };
}
const SETS = {
  lowE: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52],
  dropD: [38, 40, 38, 43, 45, 38, 50, 38],
  riff: [40, 43, 45, 40, 47, 45, 43, 40, 52, 40],
  A: [45, 47, 48, 50, 52, 53, 55, 57],
};
const MICS = { laptop: { hpHz: 150 }, phone: { hpHz: 300 }, phoneQuiet: { hpHz: 300, level: 0.1 }, phoneBridge: { hpHz: 300, pluckPos: 0.1, B: 0.0003 } };

let failed = 0;
for (const [mic, opts] of Object.entries(MICS)) for (const [name, set] of Object.entries(SETS)) {
  const r = scoreHard(set, { opts });
  const ok = r.right >= 98 && r.wrong <= 0.5 && r.react_ms <= 180 && r.missed === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${mic.padEnd(11)} ${name.padEnd(6)} correct ${r.right}%  wrong ${r.wrong}%  silent ${r.blank}%  reacts in ${r.react_ms} ms`);
}
console.log(failed ? `${failed} failed` : 'All low-string tests passed');
process.exit(failed ? 1 : 0);
