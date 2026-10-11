// YIN monophonic pitch detection (de Cheveigné & Kawahara, 2002).
// Pure function — no browser APIs — so it can be unit-tested in Node.

/**
 * @param {Float32Array} buf  time-domain samples
 * @param {number} sampleRate
 * @param {{minFreq?:number, maxFreq?:number, threshold?:number}} opts
 * @returns {{freq:number, clarity:number} | null}
 */
export function detectPitch(buf, sampleRate, opts = {}) {
  const minFreq = opts.minFreq ?? 60; // below drop-C low string (65 Hz)
  const maxFreq = opts.maxFreq ?? 1400; // above 24th fret high E (1319 Hz)
  const threshold = opts.threshold ?? 0.12;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq), Math.floor(buf.length / 2));
  // Integration window: at least two periods of the lowest note, capped for speed.
  // A longer window (opts.window) averages out more noise — the tuner uses this for steadier readings.
  const W = Math.min(buf.length - tauMax, opts.window ?? Math.max(2 * tauMax, 1024));
  if (W <= 0) return null;

  // 1. Difference function d(tau)
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const delta = buf[i] - buf[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  // 2. Cumulative mean normalised difference d'(tau)
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // 3. Absolute threshold: first dip below threshold, then slide to its local minimum.
  let tauEst = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  // No dip under threshold: fall back to the global minimum, reported with low clarity.
  if (tauEst === -1) {
    let best = tauMin;
    for (let tau = tauMin + 1; tau <= tauMax; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
    tauEst = best;
  }

  // 4. Parabolic interpolation for sub-sample accuracy.
  let betterTau = tauEst;
  if (tauEst > 1 && tauEst < tauMax) {
    const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEst + (s2 - s0) / denom;
  }

  const freq = sampleRate / betterTau;
  if (!isFinite(freq) || freq < minFreq * 0.9 || freq > maxFreq * 1.1) return null;
  return { freq, clarity: Math.max(0, Math.min(1, 1 - cmnd[tauEst])) };
}

export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/**
 * 4th-order Butterworth low-pass (two cascaded RBJ biquads). The tuner runs this just above the
 * string's fundamental so the bright upper harmonics — which are slightly sharp on a real string —
 * don't pull the reading.
 */
export function lowpass(buf, cutoff, sampleRate) {
  return biquad4(buf, cutoff, sampleRate, false);
}

/** 4th-order Butterworth high-pass: strips a lower string that's still ringing. */
export function highpass(buf, cutoff, sampleRate) {
  return biquad4(buf, cutoff, sampleRate, true);
}

function biquad4(buf, cutoff, sampleRate, high) {
  const w = (2 * Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate;
  const cs = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
  const b0 = (high ? (1 + cs) : (1 - cs)) / 2 / (1 + al);
  const b1 = (high ? -(1 + cs) : (1 - cs)) / (1 + al);
  const a1 = (-2 * cs) / (1 + al), a2 = (1 - al) / (1 + al);
  let x = buf;
  for (let pass = 0; pass < 2; pass++) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    x = y;
  }
  return x;
}
