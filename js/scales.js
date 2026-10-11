// Scales for Learn mode: which notes, where they sit on the neck, and the order to play them.
// Pure logic (no DOM) so it can be tested in Node.
import { pitchClass } from './notes.js';

// `parent` = semitones from this scale's root up to the root of the major key it borrows its key
// signature from — used to choose sharps or flats (F major → B♭, E minor → F♯, …).
export const SCALES = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11], parent: 0 },
  { id: 'minor', name: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10], parent: 3 },
  { id: 'major-pent', name: 'Major pentatonic', steps: [0, 2, 4, 7, 9], parent: 0 },
  { id: 'minor-pent', name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10], parent: 3 },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10], parent: 3 },
  { id: 'harmonic-minor', name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11], parent: 3 },
  { id: 'melodic-minor', name: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11], parent: 3 },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10], parent: 10 },
  { id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10], parent: 8 },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11], parent: 7 },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10], parent: 5 },
  { id: 'locrian', name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10], parent: 1 },
];

export const ROOTS = [
  { pc: 0, sharp: 'C', flat: 'C' }, { pc: 1, sharp: 'C♯', flat: 'D♭' }, { pc: 2, sharp: 'D', flat: 'D' },
  { pc: 3, sharp: 'D♯', flat: 'E♭' }, { pc: 4, sharp: 'E', flat: 'E' }, { pc: 5, sharp: 'F', flat: 'F' },
  { pc: 6, sharp: 'F♯', flat: 'G♭' }, { pc: 7, sharp: 'G', flat: 'G' }, { pc: 8, sharp: 'G♯', flat: 'A♭' },
  { pc: 9, sharp: 'A', flat: 'A' }, { pc: 10, sharp: 'A♯', flat: 'B♭' }, { pc: 11, sharp: 'B', flat: 'B' },
];

const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1]); // F B♭ E♭ A♭ D♭ (G♭/F♯ goes sharp)

export const scaleById = (id) => SCALES.find((s) => s.id === id) || SCALES[0];

/** Sharps or flats for this key. */
export function keyPref(rootPc, scaleId) {
  return FLAT_MAJOR_KEYS.has(pitchClass(rootPc + scaleById(scaleId).parent)) ? 'flat' : 'sharp';
}

export function rootName(rootPc, scaleId) {
  const r = ROOTS[pitchClass(rootPc)];
  return keyPref(rootPc, scaleId) === 'flat' ? r.flat : r.sharp;
}

/** Set of pitch classes in the scale. */
export function scalePcs(rootPc, scaleId) {
  return new Set(scaleById(scaleId).steps.map((st) => pitchClass(rootPc + st)));
}

/**
 * Places to play the scale: the whole neck, plus a 5-fret box starting one fret below each
 * root on the two low strings (and the open position).
 * @returns {{id:string, label:string, start:number|null}[]}
 */
export function positions(tuning, rootPc, frets) {
  const starts = new Set([0]);
  for (const open of [tuning[0], tuning[1]]) {
    for (let f = 0; f <= frets; f++) {
      if (pitchClass(open + f) === pitchClass(rootPc)) {
        const st = Math.max(0, f - 1);
        if (st + 4 <= frets) starts.add(st);
      }
    }
  }
  const boxes = [...starts].sort((a, b) => a - b).map((st) => ({
    id: `box-${st}`, start: st,
    label: st === 0 ? 'Open position (frets 0–4)' : `Frets ${st}–${st + 4}`,
  }));
  return [{ id: 'neck', start: null, label: 'Two octaves along the neck' }, ...boxes];
}

/**
 * The notes to play, in order.
 * @param {number[]} tuning  open-string MIDI notes, low → high
 * @param {{rootPc:number, scaleId:string, positionId:string, frets:number, direction:'up'|'updown'}} o
 * @returns {{s:number, f:number, midi:number, root:boolean}[]}
 */
export function buildPath(tuning, { rootPc, scaleId, positionId, frets, direction }) {
  const pcs = scalePcs(rootPc, scaleId);
  const isRoot = (m) => pitchClass(m) === pitchClass(rootPc);
  let up;
  const box = /^box-(\d+)$/.exec(positionId);
  if (box) {
    const start = Number(box[1]);
    const lo = start, hi = Math.min(frets, start + 4);
    const byPitch = new Map();
    for (let s = 0; s < tuning.length; s++) {
      for (let f = lo; f <= hi; f++) {
        const m = tuning[s] + f;
        if (!pcs.has(pitchClass(m))) continue;
        // Same pitch on two strings: take the higher string (lower fret), like a standard box shape.
        const prev = byPitch.get(m);
        if (!prev || s > prev.s) byPitch.set(m, { s, f, midi: m, root: isRoot(m) });
      }
    }
    up = [...byPitch.values()].sort((a, b) => a.midi - b.midi);
  } else {
    up = neckPath(tuning, pcs, rootPc, frets, isRoot);
  }
  return direction === 'updown' ? [...up, ...up.slice(0, -1).reverse()] : up;
}

/** Two octaves upward from the lowest root, moving along the neck by the nearest fingering. */
function neckPath(tuning, pcs, rootPc, frets, isRoot) {
  const spots = [];
  for (let s = 0; s < tuning.length; s++) for (let f = 0; f <= frets; f++) spots.push({ s, f, midi: tuning[s] + f });
  const low = spots.filter((p) => isRoot(p.midi)).sort((a, b) => a.midi - b.midi)[0];
  if (!low) return [];
  const top = low.midi + 24;
  const out = [{ ...low, root: true }];
  let cur = low;
  for (let m = low.midi + 1; m <= top; m++) {
    if (!pcs.has(pitchClass(m))) continue;
    const options = spots.filter((p) => p.midi === m);
    if (!options.length) break;
    // Prefer staying close on the neck, and moving up across strings rather than back.
    const cost = (p) => Math.abs(p.f - cur.f) * 1.0 + (p.s < cur.s ? 6 : 0) + Math.abs(p.s - cur.s) * 0.5
      + (p.f - cur.f > 3 ? (p.f - cur.f - 3) * 1.5 : 0);
    const next = options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    out.push({ ...next, root: isRoot(m) });
    cur = next;
  }
  return out;
}
