// SVG fretboard: draws the neck for any tuning and lights up every position of a note.
// High e on top, like tab.
import { noteName } from './notes.js';

const NS = 'http://www.w3.org/2000/svg';
const STRING_GAP = 34;
const PAD_Y = 22;
const OPEN_ZONE = 58; // space left of the nut for open-string markers
const FRET_LEN = 60;
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const TRAIL_LENGTH = 1; // ghost only the previous note

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
    return PAD_Y + (5 - s) * STRING_GAP;
  }

  render() {
    this.boardLen = this.frets * FRET_LEN;
    const width = OPEN_ZONE + this.boardLen + 14;
    const boardTop = PAD_Y - 14, boardBottom = this.stringY(0) + 14;
    const height = boardBottom + 28;

    this.host.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'fretboard-svg', role: 'img',
      'aria-label': 'Guitar fretboard', preserveAspectRatio: 'xMidYMid meet' }, this.host);
    svg.classList.toggle('show-names', !!this.showNames);
    this.svg = svg;

    el('rect', { x: OPEN_ZONE, y: boardTop, width: this.boardLen, height: boardBottom - boardTop, rx: 3, class: 'fb-wood' }, svg);

    const midY = (this.stringY(2) + this.stringY(3)) / 2;
    for (let f = 1; f <= this.frets; f++) {
      const cx = (this.fretX(f - 1) + this.fretX(f)) / 2;
      if (INLAYS.includes(f)) el('circle', { cx, cy: midY, r: 7, class: 'fb-inlay' }, svg);
      if (f === 12 || f === 24) {
        el('circle', { cx, cy: (this.stringY(1) + this.stringY(2)) / 2, r: 7, class: 'fb-inlay' }, svg);
        el('circle', { cx, cy: (this.stringY(3) + this.stringY(4)) / 2, r: 7, class: 'fb-inlay' }, svg);
      }
      el('text', { x: cx, y: height - 8, class: 'fb-fretnum' }, svg).textContent = f;
    }

    for (let f = 0; f <= this.frets; f++) {
      const x = this.fretX(f);
      el('line', { x1: x, x2: x, y1: boardTop, y2: boardBottom, class: f === 0 ? 'fb-nut' : 'fb-fret' }, svg);
    }

    // Strings, thicker toward the low string
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
        const g = el('g', { class: f === 0 ? 'pos open' : 'pos', transform: `translate(${cx} ${this.stringY(s)})` }, svg);
        el('circle', { r: 13 }, g);
        el('text', { dy: '0.35em' }, g).textContent = noteName(midi, this.pref);
        g.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onTap?.(midi); });
        this.positions.push({ s, f, midi, g });
      }
    }
    this.paint();
  }

  /** Light up the current note; recent notes fade out as a trail. Returns true if the note changed. */
  show(midi) {
    if (midi === this.current) return false;
    if (this.current !== null) {
      this.trail = [this.current, ...this.trail.filter((m) => m !== this.current && m !== midi)].slice(0, TRAIL_LENGTH);
    }
    this.current = midi;
    this.paint();
    return true;
  }

  setInTune(inTune) {
    this.svg?.classList.toggle('in-tune', inTune);
  }

  clearTrail() {
    this.trail = [];
    this.paint();
  }

  /** When the neck is wider than its scroll box, scroll a lit position into view if none is visible. */
  revealCurrent() {
    const scroller = this.host.parentElement;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 2) return;
    const box = scroller.getBoundingClientRect();
    const hits = this.positions.filter((p) => p.midi === this.current).map((p) => p.g.getBoundingClientRect());
    if (!hits.length || hits.some((r) => r.left >= box.left && r.right <= box.right)) return;
    const centre = box.left + box.width / 2;
    const best = hits.reduce((a, b) => (Math.abs(b.left - centre) < Math.abs(a.left - centre) ? b : a));
    scroller.scrollTo({ left: scroller.scrollLeft + best.left - centre, behavior: 'smooth' });
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
