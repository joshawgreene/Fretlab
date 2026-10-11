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
  const W = Math.min(buf.length - tauMax, Math.max(2 * tauMax, 1024));
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
