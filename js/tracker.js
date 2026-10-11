// Turns a stream of raw per-frame pitch estimates into a steady "current note".
// Pure logic (no browser APIs) so it can be tested in Node.
import { freqToMidi, midiToFreq } from './notes.js';

export const CLARITY_GATE = 0.9; // YIN confidence needed to accept a frame (see tests/pitch.test.mjs)
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
