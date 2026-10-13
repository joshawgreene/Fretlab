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
  const { est, hint } = level >= minGate ? readNote(recent, sampleRate, notes) : (notes.fastState = null, { est: null, hint: {} });
  const frame = notes.push(est, level, hint);
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
