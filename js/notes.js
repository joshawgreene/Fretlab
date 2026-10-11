// Note maths: frequency <-> MIDI, note spelling, tunings.

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Letter index + accidental for each pitch class, sharp and flat spellings.
const SHARP_SPELL = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLAT_SPELL = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];

let A4 = 440;
export const setA4 = (hz) => { A4 = hz; };
export const getA4 = () => A4;

export const freqToMidi = (f) => 69 + 12 * Math.log2(f / A4);
export const midiToFreq = (m) => A4 * Math.pow(2, (m - 69) / 12);
export const pitchClass = (m) => ((m % 12) + 12) % 12;
export const octaveOf = (m) => Math.floor(m / 12) - 1;

export function noteName(midi, pref = 'sharp') {
  return (pref === 'flat' ? FLAT_NAMES : SHARP_NAMES)[pitchClass(midi)];
}

export function noteLabel(midi, pref = 'sharp') {
  return noteName(midi, pref) + octaveOf(midi);
}

/** Both spellings for display, e.g. "C♯ / D♭" (or just "C"). */
export function enharmonic(midi) {
  const s = SHARP_NAMES[pitchClass(midi)];
  const f = FLAT_NAMES[pitchClass(midi)];
  return s === f ? s : `${s} / ${f}`;
}

/** Letter (0=C..6=B), accidental (-1, 0, 1) and octave, for staff placement. */
export function spell(midi, pref = 'sharp') {
  const [letter, acc] = (pref === 'flat' ? FLAT_SPELL : SHARP_SPELL)[pitchClass(midi)];
  return { letter, acc, octave: octaveOf(midi) };
}

/** Parse "E2", "Eb2", "E♭2", "F#3", "F♯3" -> MIDI number. */
export function parseNote(str) {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(str.trim());
  if (!m) throw new Error(`Bad note: ${str}`);
  const base = [0, 2, 4, 5, 7, 9, 11][LETTERS.indexOf(m[1].toUpperCase())];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

// Strings listed low (6th) -> high (1st).
export const TUNINGS = [
  { id: 'standard', name: 'Standard', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'drop-d', name: 'Drop D', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'half-down', name: 'Half step down (E♭)', notes: ['E♭2', 'A♭2', 'D♭3', 'G♭3', 'B♭3', 'E♭4'], pref: 'flat' },
  { id: 'd-standard', name: 'D standard', notes: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'drop-c', name: 'Drop C', notes: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'c-standard', name: 'C standard', notes: ['C2', 'F2', 'B♭2', 'E♭3', 'G3', 'C4'], pref: 'flat' },
  { id: 'open-g', name: 'Open G', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'open-d', name: 'Open D', notes: ['D2', 'A2', 'D3', 'F♯3', 'A3', 'D4'] },
  { id: 'open-e', name: 'Open E', notes: ['E2', 'B2', 'E3', 'G♯3', 'B3', 'E4'] },
  { id: 'open-c', name: 'Open C', notes: ['C2', 'G2', 'C3', 'G3', 'C4', 'E4'] },
  { id: 'dadgad', name: 'DADGAD', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
];

/** Notes offered in the custom-tuning pickers (A1 .. A4 covers sensible guitar tunings). */
export function customNoteRange(pref = 'sharp') {
  const out = [];
  for (let m = parseNote('A1'); m <= parseNote('A4'); m++) out.push({ midi: m, label: noteLabel(m, pref) });
  return out;
}
