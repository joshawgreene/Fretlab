// Tuner view: cents gauge, string pills, auto/manual string targeting.
import { noteName, noteLabel, octaveOf } from './notes.js';

const IN_TUNE_CENTS = 5;
const HOLD_MS = 900; // how long a string must stay in tune before it gets a tick
const MAX_ANGLE = 70; // needle swing in degrees at ±50 cents

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
    this.autoBtn = root.querySelector('#tuner-auto');
    this.tuning = [];
    this.pref = 'sharp';
    this.locked = null; // index of a manually chosen string, or null for auto
    this.tuned = new Set();
    this.inTuneSince = 0;
    this.drawGauge();
    this.autoBtn.addEventListener('click', () => this.setLocked(null));
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
    this.autoBtn.setAttribute('aria-pressed', String(i === null));
    this.renderPills();
  }

  renderPills() {
    this.pillsHost.innerHTML = '';
    this.pills = this.tuning.map((midi, i) => {
      const b = document.createElement('button');
      b.className = 'pill';
      b.type = 'button';
      b.innerHTML = `<span class="pill-num">${6 - i}</span><span class="pill-note">${noteName(midi, this.pref)}<sub>${octaveOf(midi)}</sub></span>`;
      b.title = `String ${6 - i}: ${noteLabel(midi, this.pref)} — tap to lock and hear it`;
      b.addEventListener('click', () => { this.setLocked(i); this.onPluck(midi); });
      this.pillsHost.appendChild(b);
      return b;
    });
    this.paintPills(null);
  }

  paintPills(target) {
    this.pills?.forEach((p, i) => {
      p.classList.toggle('target', i === target);
      p.classList.toggle('locked', i === this.locked);
      p.classList.toggle('done', this.tuned.has(i));
    });
  }

  /** Which string is the player tuning? Locked string, else the nearest string by pitch. */
  targetFor(freqMidi) {
    if (this.locked !== null) return this.locked;
    let best = 0;
    this.tuning.forEach((m, i) => { if (Math.abs(freqMidi - m) < Math.abs(freqMidi - this.tuning[best])) best = i; });
    return best;
  }

  update(frame, freqMidi) {
    if (!frame.active) {
      this.setNeedle(0, false, true);
      this.noteEl.textContent = '—';
      this.octEl.textContent = '';
      this.hzEl.textContent = '';
      this.centsEl.textContent = '';
      this.hintEl.textContent = this.locked === null ? 'Play any open string' : `Play string ${6 - this.locked}`;
      this.inTuneSince = 0;
      this.paintPills(this.locked);
      return;
    }
    const i = this.targetFor(freqMidi);
    const target = this.tuning[i];
    const cents = (freqMidi - target) * 100;
    const inTune = Math.abs(cents) <= IN_TUNE_CENTS;
    const now = performance.now();
    if (inTune) {
      this.inTuneSince ||= now;
      if (now - this.inTuneSince > HOLD_MS) this.tuned.add(i);
    } else this.inTuneSince = 0;

    this.noteEl.textContent = noteName(target, this.pref);
    this.octEl.textContent = octaveOf(target);
    this.hzEl.textContent = `${frame.freq.toFixed(1)} Hz`;
    const far = Math.abs(cents) > 50;
    this.centsEl.textContent = far ? `${Math.round(Math.abs(cents) / 100)} semitone${Math.abs(cents) >= 150 ? 's' : ''} ${cents < 0 ? 'flat' : 'sharp'}`
      : `${cents > 0 ? '+' : ''}${cents.toFixed(0)}¢`;
    this.hintEl.textContent = inTune ? 'In tune' : cents < 0 ? 'Tune up ↑' : 'Tune down ↓';
    this.root.classList.toggle('flat', !inTune && cents < 0);
    this.root.classList.toggle('sharp', !inTune && cents > 0);
    this.setNeedle(cents, inTune, false);
    this.paintPills(i);
  }

  setNeedle(cents, inTune, idle) {
    const a = Math.max(-1, Math.min(1, cents / 50)) * MAX_ANGLE;
    this.needle.style.transform = `rotate(${a}deg)`;
    this.root.classList.toggle('in-tune', inTune);
    this.root.classList.toggle('idle', idle);
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
