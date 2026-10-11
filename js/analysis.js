// One analysis step: raw samples in, note + tuner readings out.
// No browser APIs, so tests and benchmarks run exactly what the app runs.
import { detectPitch, rms, lowpass, highpass } from './pitch.js';
import { midiToFreq } from './notes.js';

export const NOTE_FRAME = 4096; // samples analysed for the live fretboard
export const TUNER_FRAME = 8192; // the tuner keeps a longer history for its filtered fine reading
const FINE_WINDOW = 3072;

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
  const minGate = tune ? notes.gate * 0.5 : notes.gate;
  const est = level >= minGate ? detectPitch(recent, sampleRate) : null;
  const frame = notes.push(est, level);
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
