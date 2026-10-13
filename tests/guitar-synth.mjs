// Simulated guitar audio for the tests: plucked strings with inharmonic overtones, pick noise,
// hum and a small mic's bass roll-off.
import { NOTE_FRAME } from '../js/analysis.js';
import { midiToFreq } from '../js/notes.js';
export const SR = 48000;
export const HOP = Math.round(SR / 60);
export function guitarNote(midi, seconds, { seed = 1, hpHz = 150, pluckPos = 1 / 7, B = 0.00015, hum = 0.004, noise = 0.004, level = 0.5, vibrato = 0, vibratoRate = 5.5 } = {}) {
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
    // vibrato (cents, peak): the pitch wobbles, as a held note does under a moving finger
    const vt = vibrato ? t - (2 ** (vibrato / 1200) - 1) / (2 * Math.PI * vibratoRate) * Math.cos(2 * Math.PI * vibratoRate * t) : t;
    for (let j = 0; j < fk.length; j++) v += amp[j] * Math.exp(-t * dk[j] / 1.5) * Math.sin(ph[j] + 2 * Math.PI * fk[j] * vt);
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

export function play(midis, noteSec, opts) {
  return playTimed(midis.map((m, i) => ({ midi: m, at: i * noteSec, dur: noteSec })), opts);
}
/** notes: [{midi, at (s), dur (s)}]. Each pick partly damps the string's previous note. */
export function playTimed(notes, opts) {
  const end = Math.max(...notes.map((x) => x.at + x.dur));
  const n = Math.round(SR * (end + 0.5)) + NOTE_FRAME, sig = new Float32Array(n);
  notes.forEach(({ midi: m, at, dur }, i) => {
    const p = guitarNote(m, Math.max(dur * 4, 0.6), { ...opts, seed: i + 3 }), off = Math.round(at * SR);
    for (let j = 0; j < p.length && off + j < n; j++) {
      const after = j - Math.round(dur * SR);
      sig[off + j] += p[j] * (after > 0 ? 0.45 * Math.exp(-after / (SR * 0.15)) : 1); // next pick partly damps it
    }
  });
  return sig;
}

