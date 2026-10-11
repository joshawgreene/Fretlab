// SVG fretboard: draws the neck for any tuning and lights up every position of a note.
import { noteName } from './notes.js';

const NS = 'http://www.w3.org/2000/svg';
const STRING_GAP = 34;
const PAD_Y = 22;
const OPEN_ZONE = 58; // space left of the nut for open-string markers
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const TRAIL_LENGTH = 3;

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

export class Fretboard {
  /**
   * @param {HTMLElement} host
   * @param {{onTap?:(midi:number)=>void}} opts
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.onTap = opts.onTap;
    this.tuning = [40, 45, 50, 55, 59, 64];
    this.frets = 15;
    this.pref = 'sharp';
    this.current = null;
    this.trail = [];
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
    return OPEN_ZONE + this.boardLen * (1 - Math.pow(r, i)) / (1 - Math.pow(r, this.frets));
  }

  stringY(s) {
    return PAD_Y + (5 - s) * STRING_GAP; // high e on top, like tab
  }

  render() {
    this.boardLen = this.frets * 60;
    const width = OPEN_ZONE + this.boardLen + 14;
    const boardTop = PAD_Y - 14, boardBottom = this.stringY(0) + 14;
    const height = boardBottom + 30;

    this.host.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'fretboard-svg', role: 'img',
      'aria-label': 'Guitar fretboard' }, this.host);
    svg.classList.toggle('show-names', !!this.showNames);
    this.svg = svg;

    // Neck
    el('rect', { x: OPEN_ZONE, y: boardTop, width: this.boardLen, height: boardBottom - boardTop, rx: 3, class: 'fb-wood' }, svg);

    // Inlays
    const midY = (this.stringY(2) + this.stringY(3)) / 2;
    for (let f = 1; f <= this.frets; f++) {
      const cx = (this.fretX(f - 1) + this.fretX(f)) / 2;
      if (INLAYS.includes(f)) el('circle', { cx, cy: midY, r: 7, class: 'fb-inlay' }, svg);
      if (f === 12 || f === 24) {
        el('circle', { cx, cy: (this.stringY(1) + this.stringY(2)) / 2, r: 7, class: 'fb-inlay' }, svg);
        el('circle', { cx, cy: (this.stringY(3) + this.stringY(4)) / 2, r: 7, class: 'fb-inlay' }, svg);
      }
    }

    // Frets + nut
    for (let f = 0; f <= this.frets; f++) {
      const x = this.fretX(f);
      el('line', { x1: x, x2: x, y1: boardTop, y2: boardBottom, class: f === 0 ? 'fb-nut' : 'fb-fret' }, svg);
      if (f > 0) {
        const t = el('text', { x: (this.fretX(f - 1) + x) / 2, y: height - 9, class: 'fb-fretnum' }, svg);
        t.textContent = f;
      }
    }

    // Strings (thicker toward the low string) with open-note labels at the headstock end
    for (let s = 0; s < 6; s++) {
      const y = this.stringY(s);
      el('line', { x1: OPEN_ZONE - 32, x2: OPEN_ZONE + this.boardLen, y1: y, y2: y, class: 'fb-string',
        'stroke-width': (2.6 - s * 0.36).toFixed(2) }, svg);
    }

    // Note positions (open string + every fret)
    this.positions = [];
    for (let s = 0; s < 6; s++) {
      for (let f = 0; f <= this.frets; f++) {
        const midi = this.tuning[s] + f;
        const cx = f === 0 ? OPEN_ZONE - 26 : (this.fretX(f - 1) + this.fretX(f)) / 2;
        const g = el('g', { class: f === 0 ? 'pos open' : 'pos', transform: `translate(${cx} ${this.stringY(s)})`,
          tabindex: '-1' }, svg);
        el('circle', { r: 13 }, g);
        const t = el('text', { dy: '0.35em' }, g);
        t.textContent = noteName(midi, this.pref);
        g.addEventListener('pointerdown', () => this.onTap?.(midi));
        this.positions.push({ s, f, midi, g });
      }
    }
    this.paint();
  }

  /** Light up the current note; recent notes fade out as a trail. */
  show(midi) {
    if (midi === this.current) return;
    if (this.current !== null) {
      this.trail = [this.current, ...this.trail.filter((m) => m !== this.current && m !== midi)].slice(0, TRAIL_LENGTH);
    }
    this.current = midi;
    this.paint();
  }

  setInTune(inTune) {
    this.svg?.classList.toggle('in-tune', inTune);
  }

  clearTrail() {
    this.trail = [];
    this.paint();
  }

  paint() {
    if (!this.positions) return;
    for (const p of this.positions) {
      const age = this.trail.indexOf(p.midi);
      p.g.classList.toggle('hit', p.midi === this.current);
      p.g.classList.toggle('trail', p.midi !== this.current && age !== -1);
      if (age !== -1) p.g.style.setProperty('--age', age);
    }
  }
}
