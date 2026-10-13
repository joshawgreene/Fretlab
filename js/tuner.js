// Tuner view: cents gauge, pitch trace, string pills, auto/manual string targeting.
import { noteName, noteLabel, octaveOf } from './notes.js';

const IN_TUNE_CENTS = 3;
const HOLD_MS = 900; // how long a string must stay in tune before it gets a tick
const MAX_ANGLE = 70; // needle swing in degrees at ±50 cents
const TRACE_SECONDS = 5;

export class Tuner {
  constructor(root, { onPluck }) {
    this.root = root;
    this.onPluck = onPluck;
    this.gauge = root.querySelector('#gauge');
    this.pillsHost = root.querySelector('#string-pills');
    this.noteEl = root.querySelector('#tuner-note');
    this.octEl = root.querySelector('#tuner-octave');
    this.hintEl = root.querySelector('#tuner-hint');
    this.hzEl = root.querySelector('#tuner-hz');
    this.centsEl = root.querySelector('#tuner-cents');
    this.trace = new Trace(root.querySelector('#tuner-trace'));
    this.tuning = [];
    this.pref = 'sharp';
    this.locked = null; // index of a manually chosen string, or null for auto
    this.tuned = new Set();
    this.inTuneSince = 0;
    this.target = null;
    this.drawGauge();
  }

  setTuning(tuning, pref) {
    this.tuning = tuning;
    this.pref = pref;
    this.tuned.clear();
    if (this.locked !== null && this.locked >= tuning.length) this.locked = null;
    this.renderPills();
  }

  setLocked(i) {
    this.locked = i;
    this.target = null;
    this.renderPills();
  }

  renderPills() {
    this.pillsHost.innerHTML = '';
    this.pills = this.tuning.map((midi, i) => {
      const b = document.createElement('button');
      b.className = 'pill';
      b.type = 'button';
      b.innerHTML = `<span class="pill-num">${6 - i}</span><span class="pill-note">${noteName(midi, this.pref)}<sub>${octaveOf(midi)}</sub></span>`;
      b.title = `String ${6 - i}: ${noteLabel(midi, this.pref)} — tap to lock on and hear it, tap again to go back to auto`;
      // Tap to lock onto this string (and hear it); tap the locked string again to go back to auto-detect.
      b.addEventListener('click', () => {
        if (this.locked === i) { this.setLocked(null); return; }
        this.setLocked(i);
        this.onPluck(midi);
      });
      this.pillsHost.appendChild(b);
      return b;
    });
    this.paintPills(this.locked);
  }

  paintPills(target) {
    this.pills?.forEach((p, i) => {
      p.classList.toggle('target', i === target);
      p.classList.toggle('locked', i === this.locked);
      p.classList.toggle('done', this.tuned.has(i));
    });
  }

  /** Which string is the player tuning? Locked string, else the nearest string by pitch (sticky, so it doesn't flicker). */
  targetFor(m) {
    if (this.locked !== null) return this.locked;
    let best = 0;
    this.tuning.forEach((n, i) => { if (Math.abs(m - n) < Math.abs(m - this.tuning[best])) best = i; });
    // Stay on the current string unless another is clearly closer.
    if (this.target !== null && this.target < this.tuning.length &&
        Math.abs(m - this.tuning[this.target]) < Math.abs(m - this.tuning[best]) + 0.3) best = this.target;
    this.target = best;
    return best;
  }

  /** @param {{active:boolean, held:boolean, midi:number|null, freq:number|null}} tune  @param {boolean} listening */
  update(tune, listening) {
    const now = performance.now();
    if (!tune?.active) {
      this.trace.push(now, null);
      this.setNeedle(0, false, true, false);
      this.noteEl.textContent = '—';
      this.octEl.textContent = '';
      this.hzEl.textContent = '—';
      this.centsEl.textContent = '';
      this.hintEl.textContent = !listening ? 'Start listening, then play a string'
        : this.locked === null ? 'Play any open string' : `Play string ${6 - this.locked}`;
      this.inTuneSince = 0;
      this.target = null;
      this.paintPills(this.locked);
      return;
    }
    const i = this.targetFor(tune.midi);
    const target = this.tuning[i];
    const cents = (tune.midi - target) * 100;
    const inTune = Math.abs(cents) <= IN_TUNE_CENTS;
    if (inTune && !tune.held) {
      this.inTuneSince ||= now;
      if (now - this.inTuneSince > HOLD_MS) this.tuned.add(i);
    } else if (!inTune) this.inTuneSince = 0;

    this.trace.push(now, tune.held ? null : cents);
    this.noteEl.textContent = noteName(target, this.pref);
    this.octEl.textContent = octaveOf(target);
    this.hzEl.textContent = tune.freq.toFixed(2);
    const abs = Math.abs(cents);
    this.centsEl.textContent = abs >= 100
      ? `${Math.round(abs / 100)} semitone${abs >= 150 ? 's' : ''} ${cents < 0 ? 'flat' : 'sharp'}`
      : `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${abs < 10 ? abs.toFixed(1) : abs.toFixed(0)}¢`;
    this.hintEl.textContent = inTune ? 'In tune' : cents < 0 ? 'Tune up ↑' : 'Tune down ↓';
    this.root.classList.toggle('flat', !inTune && cents < 0);
    this.root.classList.toggle('sharp', !inTune && cents > 0);
    this.setNeedle(cents, inTune, false, tune.held);
    this.paintPills(i);
  }

  setNeedle(cents, inTune, idle, held) {
    const a = Math.max(-1, Math.min(1, cents / 50)) * MAX_ANGLE;
    this.needle.style.transform = `rotate(${a.toFixed(2)}deg)`;
    this.root.classList.toggle('in-tune', inTune);
    this.root.classList.toggle('idle', idle);
    this.root.classList.toggle('held', held);
    if (idle) this.root.classList.remove('flat', 'sharp');
  }

  drawGauge() {
    const cx = 160, cy = 160, r = 130;
    const pt = (deg, rad) => {
      const t = ((deg - 90) * Math.PI) / 180;
      return [cx + rad * Math.cos(t), cy + rad * Math.sin(t)];
    };
    const arc = (d0, d1, rad) => {
      const [x0, y0] = pt(d0, rad), [x1, y1] = pt(d1, rad);
      return `M ${x0} ${y0} A ${rad} ${rad} 0 0 1 ${x1} ${y1}`;
    };
    let ticks = '';
    for (let c = -50; c <= 50; c += 5) {
      const deg = (c / 50) * MAX_ANGLE;
      const major = c % 25 === 0;
      const [x0, y0] = pt(deg, r - (major ? 18 : 10)), [x1, y1] = pt(deg, r);
      ticks += `<line class="g-tick${major ? ' major' : ''}" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>`;
      if (major) {
        const [tx, ty] = pt(deg, r + 16);
        ticks += `<text class="g-label" x="${tx}" y="${ty}" dy="0.35em">${c > 0 ? '+' + c : c}</text>`;
      }
    }
    const zone = (IN_TUNE_CENTS / 50) * MAX_ANGLE;
    this.gauge.innerHTML = `
      <svg viewBox="0 0 320 180" class="gauge-svg" aria-hidden="true">
        <path class="g-track" d="${arc(-MAX_ANGLE, MAX_ANGLE, r)}"/>
        <path class="g-zone" d="${arc(-zone, zone, r)}"/>
        ${ticks}
        <g class="g-needle"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 6}"/><circle cx="${cx}" cy="${cy}" r="7"/></g>
      </svg>`;
    this.needle = this.gauge.querySelector('.g-needle');
    this.needle.style.transformOrigin = `${cx}px ${cy}px`;
  }
}

/**
 * Scrolling pitch history: the last few seconds of how far off you are, so you can watch the
 * line walk into the centre band as you turn the peg. The vertical scale is stretched near zero.
 */
class Trace {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = [];
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.w = width; this.h = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  push(t, cents) {
    this.points.push({ t, c: cents });
    const cutoff = t - TRACE_SECONDS * 1000;
    while (this.points.length && this.points[0].t < cutoff) this.points.shift();
    this.draw(t);
  }

  y(c) {
    const v = Math.sign(c) * Math.sqrt(Math.min(Math.abs(c), 50) / 50); // -1..1, magnified near 0
    return this.h / 2 - v * (this.h / 2 - 3);
  }

  draw(now = performance.now()) {
    const { ctx, w, h } = this;
    if (!w) return;
    const css = getComputedStyle(this.canvas);
    const good = css.getPropertyValue('--good').trim() || '#9fd8ff';
    const off = css.getPropertyValue('--off').trim() || '#9aa3b2';
    const line = css.getPropertyValue('--line').trim() || '#d6d6d3';
    const ink = css.getPropertyValue('--ink').trim() || '#0b0b0b';
    ctx.clearRect(0, 0, w, h);

    // In-tune band and centre line
    const bandTop = this.y(IN_TUNE_CENTS), bandBottom = this.y(-IN_TUNE_CENTS);
    ctx.fillStyle = good + '22';
    ctx.fillRect(0, bandTop, w, bandBottom - bandTop);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (const c of [-25, 25]) { ctx.beginPath(); ctx.moveTo(0, this.y(c)); ctx.lineTo(w, this.y(c)); ctx.stroke(); }
    ctx.strokeStyle = good + '66';
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

    // Pitch line, coloured by whether each stretch is in tune
    const x = (t) => w - ((now - t) / (TRACE_SECONDS * 1000)) * w;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1], b = this.points[i];
      if (a.c === null || b.c === null) continue;
      ctx.strokeStyle = Math.abs(b.c) <= IN_TUNE_CENTS ? good : ink;
      ctx.beginPath();
      ctx.moveTo(x(a.t), this.y(a.c));
      ctx.lineTo(x(b.t), this.y(b.c));
      ctx.stroke();
    }
    const last = this.points.at(-1);
    if (last && last.c !== null) {
      ctx.fillStyle = Math.abs(last.c) <= IN_TUNE_CENTS ? good : ink;
      ctx.fillRect(x(last.t) - 9, this.y(last.c) - 4, 8, 8);
    }
  }
}
