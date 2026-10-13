// Scales for Learn mode: which notes, how they're spelled, the standard positions on the neck,
// and the order to play them. Pure logic (no DOM) so it can be tested in Node.
import { pitchClass } from './notes.js';

// steps: semitones above the root.
// parent: semitones from this scale's root up to the major key it takes its key signature from
//         (decides sharps or flats: F major → B♭, E minor → F♯, D dorian → no accidentals …).
// letters: which letter (counting from the root's letter, 0–6) each step is written with.
export const SCALES = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11], parent: 0 },
  { id: 'minor', name: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10], parent: 3 },
  { id: 'major-pent', name: 'Major pentatonic', steps: [0, 2, 4, 7, 9], parent: 0, letters: [0, 1, 2, 4, 5] },
  { id: 'minor-pent', name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10], parent: 3, letters: [0, 2, 3, 4, 6] },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10], parent: 3, letters: [0, 2, 3, 4, 4, 6], blueNote: 6 },
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

const LETTERS = 'CDEFGAB';
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1]); // F B♭ E♭ A♭ D♭ (G♭/F♯ is written as F♯)

export const scaleById = (id) => SCALES.find((s) => s.id === id) || SCALES[0];

/** Sharps or flats for this key. */
export function keyPref(rootPc, scaleId) {
  return FLAT_MAJOR_KEYS.has(pitchClass(rootPc + scaleById(scaleId).parent)) ? 'flat' : 'sharp';
}

export function rootName(rootPc, scaleId) {
  const r = ROOTS[pitchClass(rootPc)];
  return keyPref(rootPc, scaleId) === 'flat' ? r.flat : r.sharp;
}

/**
 * How each note of the scale is written: every degree gets its own letter (so D harmonic minor
 * has C♯, not D♭; A blues has E♭ as the flat fifth).
 * @returns {Map<number, {letter:number, acc:number, name:string}>}  pitch class → spelling
 */
export function scaleSpelling(rootPc, scaleId) {
  const sc = scaleById(scaleId);
  const rootLetter = LETTERS.indexOf(rootName(rootPc, scaleId)[0]);
  const letters = sc.letters || sc.steps.map((_, i) => i);
  const out = new Map();
  sc.steps.forEach((st, i) => {
    const pc = pitchClass(rootPc + st);
    const letter = (rootLetter + letters[i]) % 7;
    const acc = ((pc - NATURAL_PC[letter] + 18) % 12) - 6;
    out.set(pc, { letter, acc, name: LETTERS[letter] + ACC[acc] });
  });
  return out;
}

/** Set of pitch classes in the scale. */
export function scalePcs(rootPc, scaleId) {
  return new Set(scaleById(scaleId).steps.map((st) => pitchClass(rootPc + st)));
}

/**
 * The standard positions for this scale, Position 1 starting on the root on the low string:
 *  - pentatonic scales: the five box shapes, two notes per string
 *  - seven-note scales: the seven three-notes-per-string shapes
 *  - blues: the minor pentatonic boxes with the flat fifth added where it falls in the box
 * @returns {{id:string, label:string, path:{s:number,f:number,midi:number,root:boolean}[]}[]}
 */
export function positions(tuning, rootPc, scaleId, frets = 22) {
  const sc = scaleById(scaleId);
  const shapeSteps = sc.blueNote !== undefined ? sc.steps.filter((s) => s !== sc.blueNote) : sc.steps;
  const perString = shapeSteps.length <= 5 ? 2 : 3;
  const rootFret = ((pitchClass(rootPc) - pitchClass(tuning[0])) + 12) % 12;
  const out = [];
  shapeSteps.forEach((step, k) => {
    let start = rootFret + step;
    if (start > 12) start -= 12; // keep every position within reach on the neck
    const path = buildShape(tuning, rootPc, shapeSteps, tuning[0] + start, perString, frets);
    if (sc.blueNote !== undefined) addBlueNotes(path, tuning, rootPc, sc.blueNote, frets);
    if (path.length < shapeSteps.length) return;
    const fs = path.map((n) => n.f);
    out.push({ id: `pos-${k + 1}`, label: `Position ${k + 1} · frets ${Math.min(...fs)}–${Math.max(...fs)}`, path });
  });
  return out;
}

function buildShape(tuning, rootPc, steps, startMidi, perString, frets) {
  const pcs = new Set(steps.map((st) => pitchClass(rootPc + st)));
  const path = [];
  let s = 0, onString = 0;
  for (let m = startMidi; ; m++) {
    if (!pcs.has(pitchClass(m))) continue;
    let fret = m - tuning[s];
    if (onString >= perString && s + 1 < tuning.length) {
      const next = m - tuning[s + 1];
      if (next >= 0) { s++; onString = 0; fret = next; } // move up a string unless that would need a fret below the nut
    } else if (onString >= perString) break; // top string is full
    if (fret > frets) break;
    path.push({ s, f: fret, midi: m, root: pitchClass(m) === pitchClass(rootPc) });
    onString++;
    if (s === tuning.length - 1 && onString >= perString) break;
  }
  return path;
}

/** Blues: drop the flat fifth into the box, on the string where it sits inside the box's fret span. */
function addBlueNotes(path, tuning, rootPc, blueStep, frets) {
  const blue = pitchClass(rootPc + blueStep);
  const sorted = [...path].sort((a, b) => a.midi - b.midi);
  const lo = sorted[0].midi, hi = sorted[sorted.length - 1].midi;
  const fs = sorted.map((n) => n.f);
  const minF = Math.min(...fs) - 1, maxF = Math.max(...fs) + 1;
  for (let m = lo; m <= hi; m++) {
    if (pitchClass(m) !== blue) continue;
    const below = [...sorted].reverse().find((n) => n.midi < m);
    // Prefer the string of the note just below it, then the next string up.
    for (const s of [below.s, below.s + 1]) {
      const f = m - tuning[s];
      if (s < tuning.length && f >= Math.max(0, minF) && f <= Math.min(frets, maxF)) { path.push({ s, f, midi: m, root: false }); break; }
    }
  }
  path.sort((a, b) => a.midi - b.midi);
}

/**
 * The notes to play, in order.
 * @param {number[]} tuning  open-string MIDI notes, low → high
 * @param {{rootPc:number, scaleId:string, positionId:string, frets:number, direction:'up'|'updown'}} o
 */
export function buildPath(tuning, { rootPc, scaleId, positionId, frets = 22, direction = 'updown', arpeggio = false }) {
  const all = positions(tuning, rootPc, scaleId, frets);
  const pos = all.find((p) => p.id === positionId) || all[0];
  let up = pos ? pos.path : [];
  if (arpeggio) { const chord = chordPcs(rootPc, scaleId); up = up.filter((n) => chord.has(pitchClass(n.midi))); }
  return direction === 'updown' ? [...up, ...up.slice(0, -1).reverse()] : up;
}

/**
 * The scale's own triad (root, third, fifth) for arpeggio practice: the scale's major or minor third,
 * and its perfect fifth (diminished in Locrian, where there is no perfect fifth).
 */
export function chordPcs(rootPc, scaleId) {
  const st = scaleById(scaleId).steps;
  const third = st.includes(4) ? 4 : 3;
  const fifth = st.includes(7) ? 7 : 6;
  return new Set([0, third, fifth].map((x) => pitchClass(rootPc + x)));
}
