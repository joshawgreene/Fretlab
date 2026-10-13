// Learn mode at tempo. Run: node tests/learn.test.mjs
// Scales and arpeggios played as 16th notes at 80/120/160 BPM, strings left ringing, on laptop and phone
// mics, twice round (runs repeat). Mirrors app.js: the expected-note check ticks a step off, the general
// note reading is the fallback, and the blue "wrong note" marker only shows for a held wrong note.
import { analyseFrame, NOTE_FRAME, consumePluck } from '../js/analysis.js';
import { NoteTracker } from '../js/tracker.js';
import { midiToFreq } from '../js/notes.js';
import { buildPath } from '../js/scales.js';
import { SR, HOP, play } from './guitar-synth.mjs';
const WRONG_HOLD_MS = 140; // same as app.js

/** Play `midis` and drive the Learn loop over `path` (looping), like app.js does. */
function simulate(midis, noteSec, path, opts) {
  const sig = play(midis, noteSec, opts);
  const tr = new NoteTracker(); tr.gate = 0.04 * Math.pow(0.04, 0.55); tr.minFreq = midiToFreq(40) * 0.94;
  let idx = 0, heard = null, claim = null, lastMatched = null, wrongMidi = null, wrongSince = 0, step = 0;
  const events = []; // { t, kind: 'advance'|'blue', midi }
  for (let st = 0; st + NOTE_FRAME <= sig.length; st += HOP) {
    const t = (st + NOTE_FRAME) / SR;
    const want = path[idx].midi;
    tr.expect = midiToFreq(want);
    const f = analyseFrame(sig.subarray(st, st + NOTE_FRAME), SR, { notes: tr }, t * 1000);
    let advance = false;
    if (f.expect?.hit) { advance = true; consumePluck(tr); claim = want; }
    else if (f.active && f.midi !== heard) { if (f.midi === claim) claim = null; else if (f.midi === want) { advance = true; consumePluck(tr); } }
    heard = f.active ? f.midi : null; if (!f.active) claim = null;
    if (advance) {
      events.push({ t, kind: 'advance', step: step++ });
      lastMatched = want; wrongMidi = null;
      idx++;
      if (idx >= path.length) idx = path.length > 1 ? 1 : 0; // go round again
    }
    const m = f.active ? f.midi : null;
    if (m === null || m === path[idx].midi || m === lastMatched) wrongMidi = null;
    else {
      if (m !== wrongMidi) { wrongMidi = m; wrongSince = t; }
      if ((t - wrongSince) * 1000 >= WRONG_HOLD_MS) events.push({ t, kind: 'blue', midi: m });
    }
  }
  return events;
}

const STD = [40, 45, 50, 55, 59, 64];
const P = (rootPc, scaleId, positionId, arpeggio = false) => buildPath(STD, { rootPc, scaleId, positionId, arpeggio });
const RUNS = {
  'C major pos 1': P(0, 'major', 'pos-1'),
  'A minor pent pos 1': P(9, 'minor-pent', 'pos-1'),
  'E minor pent open': P(4, 'minor-pent', 'pos-1'),
  'A blues pos 2': P(9, 'blues', 'pos-2'),
  'C major arpeggio': P(0, 'major', 'pos-1', true),
  'A minor arpeggio pos 3': P(9, 'minor', 'pos-3', true),
};
const MICS = { laptop: { hpHz: 150 }, phone: { hpHz: 300 } };

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

// 1. Timing, nothing missed, nothing early, no blue flicker during clean playing — twice round each run.
const lat = []; let early = 0, missed = 0, total = 0, blue = 0;
for (const bpm of [80, 120, 160]) for (const o of Object.values(MICS)) for (const path of Object.values(RUNS)) {
  const noteSec = 60 / bpm / 4;
  const twice = [...path, ...path.slice(1)].map((n) => n.midi); // the run ends on its first note, so round two starts at step 1
  const ev = simulate(twice, noteSec, path, o);
  const adv = ev.filter((e) => e.kind === 'advance');
  adv.forEach((e) => {
    const onset = e.step * noteSec;
    if (e.t < onset) early++; else lat.push((e.t - onset) * 1000);
  });
  missed += twice.length - adv.length; total += twice.length;
  blue += ev.filter((e) => e.kind === 'blue').length;
}
lat.sort((a, b) => a - b);
const med = Math.round(lat[lat.length >> 1]), p90 = Math.round(lat[Math.floor(lat.length * 0.9)]);
check(med <= 35, `each step ticks off in ${med} ms typical (p90 ${p90} ms), 16ths at 80–160 BPM`);
check(early === 0, `no step ticked off before its note was played (${early})`);
check(missed === 0, `every note counted, twice round each run (${missed} missed of ${total})`);
check(blue === 0, `no blue wrong-note marker during clean playing (${blue} frames)`);

// 2. A definite wrong note does get the marker, promptly.
for (const [mic, o] of Object.entries(MICS)) {
  const path = RUNS['C major pos 1'];
  const wrong = path[3].midi + 1; // a semitone off, held
  const midis = [path[0].midi, path[1].midi, path[2].midi, wrong];
  const ev = simulate(midis, 0.4, path, o);
  const firstBlue = ev.find((e) => e.kind === 'blue');
  const wrongAt = 3 * 0.4;
  const delay = firstBlue ? Math.round((firstBlue.t - wrongAt) * 1000) : null;
  check(!!firstBlue && firstBlue.midi === wrong && delay < 300, `${mic}: a held wrong note is marked blue after ${delay} ms`);
  check(ev.filter((e) => e.kind === 'advance').length === 3, `${mic}: the wrong note doesn't tick the step off`);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
