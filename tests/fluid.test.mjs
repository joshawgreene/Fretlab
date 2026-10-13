// Fluidity test: fast low-string playing. Run: node tests/fluid.test.mjs
// Riffs at 4–6 notes a second, strings left ringing, hammer-ons, on laptop and phone mics.
// Measures how quickly each new note appears on the fretboard, and whether anything wrong shows.
import { analyseFrame, NOTE_FRAME } from '../js/analysis.js';
import { NoteTracker } from '../js/tracker.js';
import { midiToFreq } from '../js/notes.js';
const SR = 48000;
const HOP = Math.round(SR / 60);

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
// Build a phrase. Each note: {m, dur, legato}. legato = hammer-on/pull-off: no new pluck, pitch just changes.
function phrase(notes, { ring = 0.5, opts = {} } = {}) {
  const total = notes.reduce((a, n) => a + n.dur, 0) + 0.6;
  const sig = new Float32Array(Math.round(SR * total) + NOTE_FRAME);
  const marks = []; let t = 0, prev = null;
  notes.forEach((n, i) => {
    const off = Math.round(t * SR);
    let p = guitarNote(n.m, n.dur * 3, { ...opts, seed: i + 11 });
    if (n.legato && prev) { // continue the previous note's envelope: scale new note down to where the old one had decayed, no attack
      const k = 0.55; p = p.map((v, j) => v * k);
      for (let j = 0; j < Math.round(0.02 * SR); j++) p[j] *= j / (0.02 * SR); // no transient
    }
    for (let j = 0; j < p.length && off + j < sig.length; j++) {
      const after = j - Math.round(n.dur * SR);
      sig[off + j] += p[j] * (after > 0 ? ring * Math.exp(-after / (SR * 0.25)) : 1); // next string pick damps this one partly
    }
    marks.push({ start: t, end: t + n.dur, m: n.m }); t += n.dur; prev = n;
  });
  return { sig, marks };
}
function score(frameFn, notes, opts = {}) {
  const { sig, marks } = phrase(notes, opts);
  const tr = new NoteTracker(); tr.gate = 0.04 * Math.pow(0.04, 0.55); tr.minFreq = midiToFreq(40) * 0.94; // standard tuning
  const lat = []; let wrongFrames = 0, octFrames = 0, judged = 0, flicker = 0, missed = 0; let lastShown = null;
  const firsts = marks.map(() => null);
  for (let st = 0; st + NOTE_FRAME <= sig.length; st += HOP) {
    const t = (st + NOTE_FRAME) / SR;
    const f = frameFn(sig.subarray(st, st + NOTE_FRAME), SR, { notes: tr }, t * 1000);
    const shown = f.active ? f.midi : null;
    const i = marks.findIndex((mk) => t >= mk.start && t < mk.end); if (i < 0) continue;
    const mk = marks[i];
    if (shown === mk.m && firsts[i] === null) firsts[i] = t - mk.start;
    // after the note has had 120 ms, it should be showing — anything else counts
    if (t - mk.start > 0.12) { judged++; if (shown !== null && shown !== mk.m) { wrongFrames++; if ((shown - mk.m) % 12 === 0) octFrames++; } }
    if (shown !== lastShown && shown !== null && lastShown !== null && firsts[i] !== null && shown !== mk.m) flicker++;
    lastShown = shown;
  }
  firsts.forEach((x) => { if (x === null) missed++; else lat.push(x * 1000); });
  lat.sort((a, b) => a - b);
  return { median_ms: Math.round(lat[Math.floor(lat.length / 2)] ?? -1), p90_ms: Math.round(lat[Math.floor(lat.length * 0.9)] ?? -1), missed, wrongPct: +(100 * wrongFrames / judged).toFixed(1), octPct: +(100 * octFrames / judged).toFixed(1), flicker };
}
const N = (ms, list, legatoEvery = 0) => list.map((m, i) => ({ m, dur: ms / 1000, legato: legatoEvery && i % legatoEvery === legatoEvery - 1 }));
const PHRASES = {
  'lowE riff 250ms': N(250, [40, 43, 45, 40, 43, 46, 45, 40, 43, 45, 43, 40]),
  'lowE riff 160ms': N(160, [40, 40, 43, 40, 45, 40, 46, 45, 40, 40, 43, 40, 45, 43, 40, 38]),
  'bass walk 300ms': N(300, [40, 41, 42, 43, 45, 47, 48, 50, 52, 50, 48, 47, 45, 43]),
  'A-string scale 200ms': N(200, [45, 47, 48, 50, 52, 53, 55, 57, 55, 53, 52, 50, 48, 47, 45]),
  'hammer-ons 220ms': N(220, [40, 42, 43, 45, 47, 45, 43, 42, 40, 43, 45, 47], 2),
  'chug 180ms': N(180, [40, 40, 42, 40, 43, 40, 45, 44, 40, 40, 47, 45]),
};
const MICS = { laptop: { hpHz: 150 }, phone: { hpHz: 300 }, quietPhone: { hpHz: 300, level: 0.12 } };

const med = [], p90 = [], wrong = []; let missed = 0, flicker = 0; const t0 = performance.now(); let frames = 0;
for (const [mic, opts] of Object.entries(MICS)) for (const [name, notes] of Object.entries(PHRASES)) {
  const r = score(analyseFrame, notes, { opts });
  med.push(r.median_ms); p90.push(r.p90_ms); wrong.push(r.wrongPct); missed += r.missed; flicker += r.flicker;
  console.log(`${mic.padEnd(10)} ${name.padEnd(22)} new note shows in ${r.median_ms} ms (90% within ${r.p90_ms} ms) · wrong ${r.wrongPct}% · missed ${r.missed}`);
}
med.sort((a, b) => a - b); p90.sort((a, b) => a - b);
const m = med[Math.floor(med.length / 2)], p = p90[Math.floor(p90.length / 2)], w = wrong.reduce((a, b) => a + b) / wrong.length;
const ok = m <= 70 && p <= 100 && w <= 1 && missed <= 6 && flicker <= 2;
console.log(`${ok ? 'PASS' : 'FAIL'}  typical ${m} ms, 90th percentile ${p} ms, wrong ${w.toFixed(1)}%, missed ${missed}, flicker ${flicker}`);
process.exit(ok ? 0 : 1);
