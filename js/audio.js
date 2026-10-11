// Microphone input + analysis loop, and a little plucked-string synth for reference tones.
import { detectPitch, rms } from './pitch.js';
import { NoteTracker } from './tracker.js';
import { midiToFreq } from './notes.js';

const FFT_SIZE = 4096;

export class PitchListener {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.tracker = new NoteTracker();
    this.ctx = null;
    this.running = false;
  }

  /** Sensitivity 0..1 -> RMS gate (higher sensitivity = quieter notes accepted). */
  setSensitivity(v) {
    this.tracker.gate = 0.04 * Math.pow(0.04, v); // 0.04 .. 0.0016
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
    this.analyser.fftSize = FFT_SIZE;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(FFT_SIZE);
    this.tracker.reset();
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.tracker.reset();
    this.onFrame({ active: false, freq: null, midi: null, cents: 0, level: 0 });
  }

  loop = () => {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const level = rms(this.buf);
    const est = level >= this.tracker.gate ? detectPitch(this.buf, this.ctx.sampleRate) : null;
    this.onFrame(this.tracker.push(est, level));
    this.raf = requestAnimationFrame(this.loop);
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
