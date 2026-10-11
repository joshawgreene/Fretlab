// Turns a stream of raw per-frame pitch estimates into a steady "current note".
// Pure logic (no browser APIs) so it can be tested in Node.
import { freqToMidi, midiToFreq } from './notes.js';

export const CLARITY_GATE = 0.9; // YIN confidence needed to accept a frame (see tests/pitch.test.mjs)
const SUSTAIN_CLARITY = 0.75; // ...or this much, if it continues the note already sounding
export const SUSTAIN_LEVEL = 0.3; // ...at down to this fraction of the level gate
const HISTORY = 5; // frames in the median filter
const CONFIRM_FRAMES = 2; // frames a new note must persist before we switch to it
const RELEASE_FRAMES = 6; // silent frames before we say "nothing playing"

export class NoteTracker {
  constructor() {
    this.gate = 0.01; // RMS level below which input counts as silence (set by the sensitivity slider)
    this.reset();
  }

  reset() {
    this.history = [];
    this.candidate = null;
    this.candidateCount = 0;
    this.midi = null;
    this.silent = RELEASE_FRAMES;
  }

  /**
   * @param {{freq:number, clarity:number}|null} est  raw detector output
   * @param {number} level  frame RMS
   * @returns {{active:boolean, freq:number|null, midi:number|null, cents:number, level:number}}
   */
  push(est, level) {
    // Once a note is sounding, keep following it as it fades: a quieter, slightly less clear
    // reading at the same pitch still counts. Low strings on small mics need this most.
    if (this.midi !== null && est && est.clarity >= SUSTAIN_CLARITY && level >= this.gate * SUSTAIN_LEVEL &&
        Math.abs(freqToMidi(est.freq) - this.midi) < 0.5) {
      est = { freq: est.freq, clarity: CLARITY_GATE };
      level = Math.max(level, this.gate);
    }
    const heard = est && level >= this.gate && est.clarity >= CLARITY_GATE;
    if (!heard) {
      this.silent++;
      if (this.silent >= RELEASE_FRAMES) {
        this.history = [];
        this.candidate = null;
        this.midi = null;
      }
      return this.snapshot(level);
    }
    this.silent = 0;

    // A big jump means a new note was played: drop the old history so we react instantly.
    const med = this.median();
    if (med !== null && Math.abs(freqToMidi(est.freq) - freqToMidi(med)) > 0.6) this.history = [];
    this.history.push(est.freq);
    if (this.history.length > HISTORY) this.history.shift();

    const nearest = Math.round(freqToMidi(this.median()));
    if (nearest === this.candidate) this.candidateCount++;
    else { this.candidate = nearest; this.candidateCount = 1; }
    if (this.candidateCount >= CONFIRM_FRAMES) this.midi = nearest;
    return this.snapshot(level);
  }

  median() {
    if (!this.history.length) return null;
    const s = [...this.history].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  snapshot(level) {
    const freq = this.midi === null ? null : this.median();
    const cents = freq === null ? 0 : 1200 * Math.log2(freq / midiToFreq(this.midi));
    return { active: this.midi !== null, freq, midi: this.midi, cents, level };
  }
}

// ---------------------------------------------------------------------------
// Tuner tracking: a continuous (non-quantised) pitch that glides smoothly while you
// turn a peg, ignores one-off glitches, and holds through the string's decay.

const TUNE_RELEASE_MS = 1500; // keep showing the last reading this long after the signal goes
const TUNE_HELD_MS = 150; // after this long without a fresh reading, show the needle as "held"
const MEDIAN_OF = 5; // raw readings in the spike-rejection median

export class TuneTracker {
  constructor() {
    this.gate = 0.01;
    this.reset();
  }

  reset() {
    this.m = null; // smoothed pitch as a fractional MIDI number
    this.raw = [];
    this.jump = [];
    this.lastHeard = -Infinity;
    this.peak = 0; // loudest frame since we locked on to this note
  }

  /**
   * @param {{freq:number, clarity:number}|null} est   raw (unfiltered) reading — used to spot new notes
   * @param {number} level  frame RMS
   * @param {number} now    ms timestamp
   * @param {{freq:number, clarity:number}|null} fine  overtone-filtered reading near the tracked note
   */
  push(est, level, now, fine = null) {
    const tracking = this.m !== null;
    // Once locked on, keep following a decaying string down to half the normal level gate.
    const levelOk = level >= this.gate * (tracking ? 0.5 : 1);
    const rawM = est && est.clarity >= (tracking ? 0.8 : CLARITY_GATE) ? freqToMidi(est.freq) : null;
    let fineM = fine && fine.clarity >= 0.8 ? freqToMidi(fine.freq) : null;
    if (fineM !== null && (!tracking || Math.abs(fineM - this.m) > 0.5)) fineM = null;

    if (levelOk && (rawM !== null || fineM !== null)) {
      if (!tracking) {
        this.jump.push(rawM);
        if (this.jump.length >= 2 && Math.abs(rawM - this.jump.at(-2)) < 0.3) this.lock(rawM);
      } else if (rawM !== null && Math.abs(rawM - this.m) > 0.5) {
        // Far from where we are: a new note, or a glitch (octave error, pick noise).
        // Only move once three readings in a row agree.
        this.jump.push(rawM);
        if (this.jump.length > 3) this.jump.shift();
        if (this.jump.length === 3 && Math.max(...this.jump) - Math.min(...this.jump) < 0.3) this.lock(median(this.jump));
      } else {
        this.jump = [];
        this.raw.push(fineM ?? rawM);
        if (this.raw.length > MEDIAN_OF) this.raw.shift();
        const target = median(this.raw);
        const diffCents = Math.abs(target - this.m) * 100;
        // Adaptive smoothing: small differences are mostly noise, so average them heavily;
        // big ones are you turning the peg, so follow quickly.
        let alpha = 0.1 + 0.6 * Math.min(1, diffCents / 15);
        // As the string dies away the readings get noisier, so trust quiet frames less.
        this.peak = Math.max(this.peak, level);
        alpha *= Math.max(0.2, Math.min(1, level / (this.peak * 0.25)));
        this.m += alpha * (target - this.m);
      }
      this.lastHeard = now;
    } else if (now - this.lastHeard > TUNE_RELEASE_MS) {
      this.reset();
    }

    const active = this.m !== null;
    return {
      active,
      held: active && now - this.lastHeard > TUNE_HELD_MS,
      midi: this.m,
      freq: active ? midiToFreq(this.m) : null,
      level,
    };
  }

  lock(m) {
    this.m = m;
    this.peak = 0;
    this.raw = [m];
    this.jump = [];
  }
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
