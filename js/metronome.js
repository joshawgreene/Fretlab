// Metronome: clicks scheduled ahead on the audio clock (rock-steady even if the page is busy),
// beat 1 of each bar accented. The click is a short burst of filtered noise rather than a beep,
// so it has no pitch for the note detector to latch on to.

const LOOKAHEAD = 0.12; // seconds of clicks scheduled in advance
const TICK_MS = 25;     // how often the scheduler wakes up

export class Metronome {
  /**
   * @param {() => AudioContext} getContext  shared audio context (created on first use)
   * @param {(beat:number) => void} onBeat     called in time with each click (0 = downbeat)
   */
  constructor(getContext, onBeat) {
    this.getContext = getContext;
    this.onBeat = onBeat;
    this.bpm = 80;
    this.beatsPerBar = 4;
    this.running = false;
  }

  setBpm(bpm) {
    this.bpm = Math.max(30, Math.min(260, Math.round(bpm)));
  }

  start() {
    if (this.running) return;
    const ctx = this.getContext();
    if (ctx.state === 'suspended') ctx.resume();
    this.ctx = ctx;
    this.running = true;
    this.beat = 0;
    this.nextTime = ctx.currentTime + 0.06;
    this.noise = this.noise || makeNoise(ctx);
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.onBeat(-1);
  }

  toggle() { this.running ? this.stop() : this.start(); }

  schedule() {
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      const beat = this.beat;
      this.click(this.nextTime, beat === 0);
      const delay = Math.max(0, (this.nextTime - ctx.currentTime) * 1000);
      setTimeout(() => { if (this.running) this.onBeat(beat); }, delay);
      this.nextTime += 60 / this.bpm;
      this.beat = (beat + 1) % this.beatsPerBar;
    }
  }

  click(when, accent) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = accent ? 3200 : 2200;
    band.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(accent ? 0.9 : 0.55, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.035);
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(when);
    src.stop(when + 0.04);
  }
}

function makeNoise(ctx) {
  const len = Math.round(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
