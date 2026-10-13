// SVG fretboard: draws the neck for any tuning and lights up every position of a note.
// High e on top, like tab. It's drawn to fill whatever box it's given (re-drawn on resize),
// so the neck always uses the full width and height available.
import { noteName } from './notes.js';

const NS = 'http://www.w3.org/2000/svg';
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const TRAIL_LENGTH = 1; // ghost only the previous note
const MAX_STRING_GAP = 64; // beyond this the neck stops growing taller and is centred instead

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

export class Fretboard {
  /**
   * @param {HTMLElement} host
   * @param {{onTap?:(midi:number, s:number, f:number)=>void}} opts
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.onTap = opts.onTap;
    this.tuning = [40, 45, 50, 55, 59, 64];
    this.frets = 15;
    this.pref = 'sharp';
    this.current = null;
    this.trail = [];
    this.learn = null;
    this.size = { w: 0, h: 0 };
    // Redraw when the box changes size (window resize, rotation, layout changes).
    new ResizeObserver(() => {
      const { width, height } = this.host.getBoundingClientRect();
      const w = Math.round(width), h = Math.round(height);
      if (w > 0 && h > 0 && (w !== this.size.w || h !== this.size.h)) {
        cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame(() => this.render());
      }
    }).observe(this.host);
  }

  /**
   * Learn mode overlay. `learn` = { pcs:Set<number>, rootPc, path:[{s,f}], index } or null.
   * Scale notes go orange everywhere; the ones in the chosen position are brighter; the next
   * note to play is outlined; notes already played are dimmed.
   */
  setLearn(learn) {
    const wasLearning = !!this.learn;
    this.learn = learn;
    if (learn) this.trail = [];
    if (learn && !wasLearning) this.hitAt = null;
    this.paint();
  }

  /** Brief "got it" flash on a position. */
  flash(s, f) {
    const p = this.positions?.find((q) => q.s === s && q.f === f);
    if (!p) return;
    p.g.classList.remove('correct');
    void p.g.getBBox(); // restart the animation
    p.g.classList.add('correct');
    setTimeout(() => p.g.classList.remove('correct'), 450);
  }

  configure({ tuning, frets, pref, showNames }) {
    if (tuning) this.tuning = tuning;
    if (frets) this.frets = frets;
    if (pref) this.pref = pref;
    if (showNames !== undefined) this.showNames = showNames;
    this.render();
  }

  fretX(i) {
    // Frets get gradually narrower up the neck, like a real guitar (softened so high frets stay tappable).
    const r = 0.965;
    return this.nutX + this.boardLen * (1 - Math.pow(r, i)) / (1 - Math.pow(r, this.frets));
  }

  stringY(s) {
    return this.topY + this.edge + (5 - s) * this.gap;
  }

  render() {
    const { width, height } = this.host.getBoundingClientRect();
    const W = Math.max(320, Math.round(width)), H = Math.max(120, Math.round(height));
    this.size = { w: Math.round(width), h: Math.round(height) };

    // Layout in real pixels: open-string column, the neck, a row of fret numbers underneath.
    const numRow = 20, padTop = 6;
    this.gap = Math.min(MAX_STRING_GAP, (H - numRow - padTop) / 5.9);
    this.edge = this.gap * 0.45;
    const boardH = this.gap * 5 + this.edge * 2;
    this.topY = padTop + Math.max(0, (H - numRow - padTop - boardH) / 2);
    this.nutX = Math.max(40, Math.min(64, this.gap * 1.3));
    this.boardLen = W - this.nutX - 6;
    const narrowest = this.fretX(this.frets) - this.fretX(this.frets - 1);
    const size = Math.max(14, Math.min(this.gap * 0.74, narrowest * 0.78, 36)); // marker square
    const font = Math.max(9, Math.min(14, size * 0.46));
    const boardTop = this.topY, boardBottom = this.topY + boardH;

    this.host.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'fretboard-svg', role: 'img',
      'aria-label': 'Guitar fretboard' }, this.host);
    svg.style.setProperty('--fb-font', `${font}px`);
    svg.classList.toggle('show-names', !!this.showNames);
    this.svg = svg;

    el('rect', { x: this.nutX, y: boardTop, width: this.boardLen, height: boardH, class: 'fb-wood' }, svg);

    const inlay = Math.max(6, this.gap * 0.22);
    const dot = (cx, cy) => el('rect', { x: cx - inlay / 2, y: cy - inlay / 2, width: inlay, height: inlay, class: 'fb-inlay' }, svg);
    for (let f = 1; f <= this.frets; f++) {
      const cx = (this.fretX(f - 1) + this.fretX(f)) / 2;
      if (INLAYS.includes(f)) dot(cx, (this.stringY(2) + this.stringY(3)) / 2);
      if (f === 12 || f === 24) {
        dot(cx, (this.stringY(1) + this.stringY(2)) / 2);
        dot(cx, (this.stringY(3) + this.stringY(4)) / 2);
      }
      el('text', { x: cx, y: boardBottom + numRow - 5, class: 'fb-fretnum' }, svg).textContent = f;
    }

    for (let f = 0; f <= this.frets; f++) {
      const x = this.fretX(f);
      el('line', { x1: x, x2: x, y1: boardTop, y2: boardBottom, class: f === 0 ? 'fb-nut' : 'fb-fret' }, svg);
    }

    // Strings, thicker toward the low string
    for (let s = 0; s < 6; s++) {
      const y = this.stringY(s);
      el('line', { x1: 4, x2: this.nutX + this.boardLen, y1: y, y2: y, class: 'fb-string',
        'stroke-width': (2.8 - s * 0.38).toFixed(2) }, svg);
    }

    // Note positions (open string + every fret): square markers
    this.positions = [];
    const openX = Math.max(size / 2 + 3, this.nutX / 2);
    for (let s = 0; s < 6; s++) {
      for (let f = 0; f <= this.frets; f++) {
        const midi = this.tuning[s] + f;
        const cx = f === 0 ? openX : (this.fretX(f - 1) + this.fretX(f)) / 2;
        const g = el('g', { class: f === 0 ? 'pos open' : 'pos', transform: `translate(${cx.toFixed(1)} ${this.stringY(s).toFixed(1)})` }, svg);
        el('rect', { x: -size / 2, y: -size / 2, width: size, height: size }, g);
        el('text', { dy: '0.36em' }, g).textContent = noteName(midi, this.pref);
        g.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onTap?.(midi, s, f); });
        this.positions.push({ s, f, midi, g });
      }
    }
    this.paint();
  }

  /**
   * Light up the note being played. Returns true if the note changed.
   * Fretboard mode lights every place that pitch lives. Learn mode assumes you're playing the scale
   * in order, so it lights just one square: the exact one tapped (`at`), or otherwise the place
   * that pitch sits nearest the note you're meant to be playing.
   */
  show(midi, at = null) {
    if (midi === this.current && !at) return false;
    if (this.current !== null && midi !== this.current) {
      this.trail = [this.current, ...this.trail.filter((m) => m !== this.current && m !== midi)].slice(0, TRAIL_LENGTH);
    }
    this.current = midi;
    this.hitAt = at || this.nearestToTarget(midi);
    this.paint();
    return true;
  }

  /** In Learn mode: where on the neck this pitch most likely is, given the note we're waiting for. */
  nearestToTarget(midi) {
    const L = this.learn;
    const t = L && L.path[Math.min(L.index, L.path.length - 1)];
    if (!t || midi === null) return null;
    let best = null, bestCost = Infinity;
    for (const p of this.positions || []) {
      if (p.midi !== midi) continue;
      const cost = Math.abs(p.f - t.f) + 1.5 * Math.abs(p.s - t.s);
      if (cost < bestCost) { bestCost = cost; best = { s: p.s, f: p.f }; }
    }
    return best;
  }

  setInTune(inTune) {
    this.svg?.classList.toggle('in-tune', inTune);
  }

  clearTrail() {
    this.trail = [];
    this.paint();
  }

  /** The neck always fits its box now, so there's nothing to scroll to. Kept for callers. */
  revealCurrent() {}

  paint() {
    if (!this.positions) return;
    const L = this.learn;
    const key = (s, f) => s * 100 + f;
    const pathIdx = new Map();
    L?.path.forEach((n, i) => { if (!pathIdx.has(key(n.s, n.f))) pathIdx.set(key(n.s, n.f), i); });
    const target = L && L.index < L.path.length ? L.path[L.index] : null;
    // An up-and-down run revisits the same squares, so each half counts separately: squares played on the
    // way up dim, then light up again for the way down.
    let top = 0;
    L?.path.forEach((n, i) => { if (n.midi > L.path[top].midi) top = i; });
    const segStart = L && L.index > top ? top : 0;
    const doneSet = new Set(L ? L.path.slice(segStart, L.index).map((n) => key(n.s, n.f)) : []);
    this.svg?.classList.toggle('learning', !!L);
    for (const p of this.positions) {
      const age = this.trail.indexOf(p.midi);
      const isHit = p.midi === this.current && (!L || (!!this.hitAt && this.hitAt.s === p.s && this.hitAt.f === p.f));
      p.g.classList.toggle('hit', isHit);
      p.g.classList.toggle('trail', !L && p.midi !== this.current && age !== -1);
      if (age !== -1) p.g.style.setProperty('--age', age);
      const k = key(p.s, p.f);
      const inScale = !!L && L.pcs.has(((p.midi % 12) + 12) % 12);
      p.g.classList.toggle('scale', inScale);
      p.g.classList.toggle('root', inScale && ((p.midi - L.rootPc) % 12 + 12) % 12 === 0);
      p.g.classList.toggle('in-path', !!L && pathIdx.has(k));
      p.g.classList.toggle('done', !!L && doneSet.has(k) && !(target && target.s === p.s && target.f === p.f));
      p.g.classList.toggle('target', !!target && target.s === p.s && target.f === p.f);
    }
  }
}
