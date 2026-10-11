// Microphone input + analysis loop, and a little plucked-string synth for reference tones.
import { NoteTracker, TuneTracker } from './tracker.js';
import { analyseFrame, NOTE_FRAME, TUNER_FRAME } from './analysis.js';
import { midiToFreq } from './notes.js';

export class PitchListener {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.tracker = new NoteTracker();
    this.tuneTracker = new TuneTracker();
    this.tunerMode = false;
    this.ctx = null;
    this.running = false;
  }

  /** The tuner analyses a longer stretch of audio for a finer, steadier reading. */
  setTunerMode(on) {
    this.tunerMode = on;
    this.tuneTracker.reset();
    this.sizeBuffer();
  }

  sizeBuffer() {
    if (!this.analyser) return;
    const size = this.tunerMode ? TUNER_FRAME : NOTE_FRAME;
    this.analyser.fftSize = size;
    this.buf = new Float32Array(size);
  }

  /** Sensitivity 0..1 -> RMS gate (higher sensitivity = quieter notes accepted). */
  setSensitivity(v) {
    this.tracker.gate = this.tuneTracker.gate = 0.04 * Math.pow(0.04, v); // 0.04 .. 0.0016
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser can’t access the microphone (it needs HTTPS or localhost).');
    }
    // Browser voice processing mangles instrument audio — switch it all off.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.source.connect(this.analyser);
    this.sizeBuffer();
    this.tracker.reset();
    this.tuneTracker.reset();
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.tracker.reset();
    this.tuneTracker.reset();
    this.onFrame({ active: false, freq: null, midi: null, cents: 0, level: 0, tune: { active: false, held: false, midi: null, freq: null } });
  }

  /** Pick up again after the browser suspended audio (iOS does this when backgrounded). */
  async resume() {
    if (!this.running) return;
    const track = this.stream?.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') {
      // The OS took the mic away (e.g. a phone call): start over.
      this.stop();
      await this.start();
      return;
    }
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  loop = (now = performance.now()) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    // ~40 analyses a second is plenty; skipping frames on 90/120 Hz phone screens saves battery.
    if (now - (this.lastRun || 0) < 22) return;
    this.lastRun = now;
    this.analyser.getFloatTimeDomainData(this.buf);
    const trackers = { notes: this.tracker, tune: this.tunerMode ? this.tuneTracker : undefined };
    this.onFrame(analyseFrame(this.buf, this.ctx.sampleRate, trackers, now));
  };

  /** Short plucked-string tone for a MIDI note (reference pitch / fretboard taps). */
  pluck(midi, seconds = 1.8) {
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const ctx = this.ctx, t = ctx.currentTime, f = midiToFreq(midi);
    // Bright sawtooth whose brightness and level decay like a plucked string.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(Math.min(f * 10, 9000), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 200), t + seconds * 0.6);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + seconds + 0.05);
  }
}
