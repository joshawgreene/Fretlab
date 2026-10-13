// One analysis step: raw samples in, note + tuner readings out.
// No browser APIs, so tests and benchmarks run exactly what the app runs.
import { detectPitch, rms, lowpass, highpass } from './pitch.js';
import { midiToFreq, freqToMidi } from './notes.js';
import { SUSTAIN_LEVEL, CLARITY_GATE } from './tracker.js';

export const NOTE_FRAME = 4096; // samples analysed for the live fretboard
export const TUNER_FRAME = 8192; // the tuner keeps a longer history for its filtered fine reading
const FINE_WINDOW = 3072;
const LOW_NOTE_HZ = 500; // roughly the bottom four strings and their lower frets
const SHORT_FRACTION = 0.4; // the "fast" reading looks at just the newest 40% of the frame (~34 ms)
const FAST_CLEAR = 0.88; // a fast reading this clear can switch notes on its own...
const FAST_AGREE = 0.6; // ...or this clear, if two fast readings in a row agree on the same pitch
const ONSET_RATIO = 1.35; // newest audio this much louder than the rest = a fresh pluck
const ONSET_FRAMES = 4; // how long after a pluck the fast reading is trusted to switch notes
const PICK_FLUX = 1.45; // brightest recent window this much above the typical one 32–80 ms ago = a new pick
const PICK_FLUX_RELEASE = 1.15;
const PICK_SAME = 0.86; // ...or the newest cycles suddenly match the ones 30 ms earlier less than this

/** RMS of the sample-to-sample difference (a crude measure of high-frequency energy). */
function diffRms(x, a, b) {
  let s = 0;
  for (let i = Math.max(1, a); i < b; i++) { const d = x[i] - x[i - 1]; s += d * d; }
  return Math.sqrt(s / Math.max(1, b - a));
}
/**
 * Has the note just been picked? A pick brings back a burst of bright (high-frequency) energy —
 * picking the same note again barely changes the loudness of a sustained note, but it always restores
 * the overtones that had died away. Measured over whole periods of the note (so the waveform's own
 * shape doesn't make it flicker): the brightest window in the newest ~20 ms against the typical one
 * 32–80 ms ago.
 */
/**
 * How well the newest two cycles match the cycles ~30 ms earlier (normalised correlation, best lag near
 * a whole number of periods). A held note matches itself (> 0.9); picking it again restarts the string
 * at a new phase and shape, so for a moment it doesn't.
 */
function sameness(x, sr, freq) {
  const T = sr / freq, n = x.length;
  const W = Math.max(Math.round(T * 2), Math.round(sr * 0.006));
  const k = Math.max(1, Math.round(0.03 * freq));
  const lo = Math.floor(k * T * 0.985), hi = Math.ceil(k * T * 1.015);
  let best = -1;
  for (let tau = lo; tau <= hi && n - W - tau >= 0; tau++) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = n - W; i < n; i++) { const a = x[i], b = x[i - tau]; ab += a * b; aa += a * a; bb += b * b; }
    best = Math.max(best, ab / Math.sqrt(aa * bb + 1e-12));
  }
  return best < -0.5 ? 1 : best;
}

function pickFlux(x, sr, freq) {
  const T = sr / freq;
  const L = Math.max(8, Math.round(T * Math.max(1, Math.ceil(0.004 * freq)))); // ≥ 4 ms, whole periods
  const step = Math.max(4, Math.round(L / 2)), n = x.length;
  let peak = 0;
  const ref = [];
  for (let e = n; e - L >= 0 && e >= n - 0.08 * sr; e -= step) {
    const v = diffRms(x, e - L, e);
    if (e >= n - 0.02 * sr) peak = Math.max(peak, v);
    else if (e <= n - 0.032 * sr) ref.push(v);
  }
  if (!ref.length) return 1;
  ref.sort((a, b) => a - b);
  return peak / (ref[ref.length >> 1] + 1e-9);
}

/** Keep every Nth sample. Only call on audio that's already been low-passed below the new Nyquist. */
function decimate(x, n) {
  const out = new Float32Array(Math.floor(x.length / n));
  for (let i = 0; i < out.length; i++) out[i] = x[i * n];
  return out;
}

/**
 * Note reading for the live fretboard and Learn mode.
 *
 * Two readings every frame from a 24 kHz copy of the audio:
 *  - a steady one over the whole frame (~85 ms), and
 *  - a fast one over just the newest ~34 ms, which hears a new note long before the old one has
 *    left the window.
 * The fast reading wins when it confidently hears a different note, or right after a pluck
 * (a jump in loudness) — and right after a pluck, when the old string is still ringing and makes
 * every reading look messy, two fast readings that agree are enough.
 * Low notes get a second look with the bright overtones filtered out, and nothing below the
 * tuning's lowest open string is accepted (that's where small mics produce octave-down errors).
 */
function readNote(frame, sampleRate, notes) {
  const minFreq = notes.minFreq ?? 60;
  const x = decimate(lowpass(frame, 4500, sampleRate), 2), sr = sampleRate / 2;
  const cut = Math.round(x.length * (1 - SHORT_FRACTION));
  const newest = x.subarray(cut);
  const look = (seg) => {
    const e = detectPitch(seg, sr, { minFreq });
    if (!e || e.freq >= LOW_NOTE_HZ) return e;
    const smooth = detectPitch(decimate(lowpass(seg, 1100, sr), 2), sr / 2, { minFreq, maxFreq: 1000 });
    return smooth && smooth.clarity > e.clarity ? smooth : e;
  };
  const steady = look(x), fast = look(newest);

  const st = notes.fastState ||= { prev: null, sincePluck: 99 };
  const loudness = rms(newest) / (rms(x.subarray(0, cut)) + 1e-9);
  st.sincePluck = loudness > ONSET_RATIO ? 0 : st.sincePluck + 1;
  st.sinceConsume = (st.sinceConsume ?? 99) + 1;
  // Learn and Play know which note should come next: check for it directly (much quicker than
  // working out an unknown note), see expectCheck().
  notes.expectResult = notes.expect ? expectCheck(x, sr, notes.expect, st) : null;
  const fastM = fast ? freqToMidi(fast.freq) : null;
  const steadyM = steady ? freqToMidi(steady.freq) : null;
  const differs = fastM !== null && (steadyM === null || Math.abs(fastM - steadyM) > 0.5 || steady.clarity < 0.75);
  const agrees = fastM !== null && st.prev !== null && Math.abs(fastM - st.prev) < 0.35;
  const justPlucked = st.sincePluck <= ONSET_FRAMES;
  st.prev = fast && fast.clarity >= FAST_AGREE ? fastM : null;

  if (fast && (differs || justPlucked) && (fast.clarity >= FAST_CLEAR || (fast.clarity >= FAST_AGREE && agrees))) {
    return { est: { freq: fast.freq, clarity: Math.max(fast.clarity, CLARITY_GATE) }, hint: { confirm: 1 } };
  }
  return { est: steady, hint: {} };
}

const EXPECT_CLEAR = 0.8;  // how periodic the newest audio must be at the expected pitch
const EXPECT_ABSENT = 0.6; // ...having first been clearly absent (below this) since it became the target

/**
 * Is the expected note being played right now? Only needs ~2.5 cycles of the newest audio
 * (≈12 ms for a high note, ≈30 ms for the low E), versus the ~34 ms+ needed to name an unknown note.
 *  - periodicity is measured (YIN) only within ±3% of the expected period (a semitone is 6%),
 *    and the best match must sit inside that window, not at its edge;
 *  - it must NOT also be periodic at half that period, or it's really the octave above
 *    (a higher note still ringing is periodic at every multiple of its own period);
 *  - the note must first read as absent after becoming the target, or be picked afresh, so the
 *    previous note still ringing (or one long-held note) can never tick off more than one step.
 */
function expectCheck(x, sr, freq, st) {
  // A fresh pick of this note: a burst of brightness (reliable on low notes), or the waveform suddenly
  // no longer lining up with itself from 30 ms before (reliable from about E3 up). Both are judged
  // against the last few frames, so another string still ringing doesn't hide or fake a pick.
  const flux = pickFlux(x, sr, freq);
  const bright = flux > PICK_FLUX && !st.bright;
  st.bright = flux > PICK_FLUX ? true : flux < PICK_FLUX_RELEASE ? false : !!st.bright;
  let broke = false;
  if (freq >= 150) {
    const same = sameness(x, sr, freq);
    const hist = st.sameHist ||= [];
    broke = same < PICK_SAME && hist.length > 0 && same < Math.max(...hist) - 0.15;
    hist.push(same); if (hist.length > 3) hist.shift();
  }
  st.sincePick = (st.sincePick ?? 99) + 1;
  const onset = (bright || broke) && st.sincePick >= 3;
  if (bright || broke) st.sincePick = 0;
  const T = sr / freq;
  const lo = Math.floor(T * 0.97), hi = Math.ceil(T * 1.03);
  const tauMax = Math.min(hi + 1, (x.length >> 1) - 1);
  const W = Math.min(x.length - tauMax, Math.max(Math.round(T * 1.5), 48));
  const start = x.length - W - tauMax;
  if (start < 0) return null;
  let run = 0, best = 1, bestTau = 0, half = 1;
  const hlo = T * 0.485, hhi = T * 0.515;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = start; i < start + W; i++) { const v = x[i] - x[i + tau]; sum += v * v; }
    run += sum;
    const c = run > 0 ? (sum * tau) / run : 1;
    if (tau >= lo && tau <= hi && c < best) { best = c; bestTau = tau; }
    if (tau >= hlo && tau <= hhi) half = Math.min(half, c);
  }
  const clarity = 1 - best, halfClarity = 1 - half;
  if (st.expectFreq !== freq) { st.expectFreq = freq; st.armed = false; }
  if (clarity < EXPECT_ABSENT) st.armed = true;
  // The same note again (common in music): a fresh pick re-arms it, once the last hit is a few frames old.
  if (onset && st.sinceConsume >= 4) st.armed = true; // (≈ 65 ms: anything sooner is the same pick)
  const inside = bestTau > lo && bestTau < hi;
  const hit = st.armed && inside && clarity >= EXPECT_CLEAR && halfClarity < clarity - 0.2;
  return { hit, clarity, halfClarity };
}

/** Learn and Play call this when it accepts an expected-note hit (re-arms for the next target). */
export function consumePluck(notes) {
  if (notes.fastState) { notes.fastState.armed = false; notes.fastState.sinceConsume = 0; }
}

/**
 * @param {Float32Array} buf  newest samples (TUNER_FRAME long in tuner mode, else NOTE_FRAME)
 * @param {number} sampleRate
 * @param {{notes: import('./tracker.js').NoteTracker, tune?: import('./tracker.js').TuneTracker}} trackers
 * @param {number} now  ms timestamp
 */
export function analyseFrame(buf, sampleRate, trackers, now) {
  const recent = buf.length > NOTE_FRAME ? buf.subarray(buf.length - NOTE_FRAME) : buf;
  const level = rms(recent);
  const { notes, tune } = trackers;
  const minGate = notes.gate * (tune ? Math.min(0.5, SUSTAIN_LEVEL) : SUSTAIN_LEVEL);
  if (level < minGate) notes.expectResult = null;
  const { est, hint } = level >= minGate ? readNote(recent, sampleRate, notes) : (notes.fastState = null, { est: null, hint: {} });
  const frame = { ...notes.push(est, level, hint), expect: notes.expectResult };
  if (!tune) return frame;

  // Fine reading for the tuner: band-limit around the note we're tracking. Cutting the upper
  // harmonics stops their slight sharpness pulling the reading; cutting below drops a lower
  // string that's still ringing. Then measure over a longer window to average out noise.
  let fine = null;
  if (tune.m !== null && level >= notes.gate * 0.5) {
    const f = midiToFreq(tune.m);
    const filtered = highpass(lowpass(buf, f * 1.6, sampleRate), f * 0.85, sampleRate);
    const keep = Math.min(filtered.length, FINE_WINDOW + Math.ceil(sampleRate / (f * 0.7)) + 2);
    fine = detectPitch(filtered.subarray(filtered.length - keep), sampleRate,
      { window: FINE_WINDOW, minFreq: f * 0.7, maxFreq: f * 1.45 });
  }
  return { ...frame, tune: tune.push(est, level, now, fine) };
}
