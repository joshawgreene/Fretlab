// Chord mode: chord types and spelling, playable shapes for any tuning, naming a chord drawn on the
// neck, and suggestions for where to go next. Pure functions (tested in Node).
import { pitchClass } from './notes.js';
import { keyPref } from './scales.js';

const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

// Each tone: [semitones above the root, degree]. `opt` tones may be left out of a shape (the 5th of a
// four-note chord, as guitarists usually do).
export const CHORD_TYPES = [
  { id: 'maj', name: 'major', suffix: '', tones: [[0, 1], [4, 3], [7, 5]] },
  { id: 'min', name: 'minor', suffix: 'm', tones: [[0, 1], [3, 3], [7, 5]] },
  { id: '7', name: 'dominant 7th', suffix: '7', tones: [[0, 1], [4, 3], [7, 5], [10, 7]], opt: [5] },
  { id: 'maj7', name: 'major 7th', suffix: 'maj7', tones: [[0, 1], [4, 3], [7, 5], [11, 7]], opt: [5] },
  { id: 'm7', name: 'minor 7th', suffix: 'm7', tones: [[0, 1], [3, 3], [7, 5], [10, 7]], opt: [5] },
  { id: 'sus2', name: 'suspended 2nd', suffix: 'sus2', tones: [[0, 1], [2, 2], [7, 5]] },
  { id: 'sus4', name: 'suspended 4th', suffix: 'sus4', tones: [[0, 1], [5, 4], [7, 5]] },
  { id: '5', name: 'power chord', suffix: '5', tones: [[0, 1], [7, 5]] },
  { id: '6', name: 'major 6th', suffix: '6', tones: [[0, 1], [4, 3], [7, 5], [9, 6]], opt: [5] },
  { id: 'm6', name: 'minor 6th', suffix: 'm6', tones: [[0, 1], [3, 3], [7, 5], [9, 6]], opt: [5] },
  { id: 'add9', name: 'add 9', suffix: 'add9', tones: [[0, 1], [4, 3], [7, 5], [14, 9]], opt: [5] },
  { id: '9', name: 'dominant 9th', suffix: '9', tones: [[0, 1], [4, 3], [7, 5], [10, 7], [14, 9]], opt: [5] },
  { id: 'm9', name: 'minor 9th', suffix: 'm9', tones: [[0, 1], [3, 3], [7, 5], [10, 7], [14, 9]], opt: [5] },
  { id: '7sus4', name: '7th suspended 4th', suffix: '7sus4', tones: [[0, 1], [5, 4], [7, 5], [10, 7]], opt: [5] },
  { id: 'dim', name: 'diminished', suffix: 'dim', tones: [[0, 1], [3, 3], [6, 5]] },
  { id: 'm7b5', name: 'half-diminished', suffix: 'm7♭5', tones: [[0, 1], [3, 3], [6, 5], [10, 7]] },
  { id: 'dim7', name: 'diminished 7th', suffix: 'dim7', tones: [[0, 1], [3, 3], [6, 5], [9, 7]] },
  { id: 'aug', name: 'augmented', suffix: 'aug', tones: [[0, 1], [4, 3], [8, 5]] },
];
export const chordType = (id) => CHORD_TYPES.find((t) => t.id === id) || CHORD_TYPES[0];

// Chord roots: sharps or flats as the chord's own key would write them (G♯m, D♭, F♯…)
const SHARP_SPELL = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLAT_SPELL = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
const MINORISH = ['min', 'm7', 'm6', 'm9', 'dim', 'm7b5', 'dim7'];
const rootPref = (pc, typeId) => keyPref(pitchClass(pc), MINORISH.includes(typeId) ? 'minor' : 'major');
const rootSpell = (pc, typeId = 'maj', pref = null) => ((pref || rootPref(pc, typeId)) === 'flat' ? FLAT_SPELL : SHARP_SPELL)[pitchClass(pc)];
export const rootLabel = (pc, typeId = 'maj', pref = null) => { const [l, a] = rootSpell(pc, typeId, pref); return LETTERS[l] + ACC[a]; };
export const CHORD_ROOTS = Array.from({ length: 12 }, (_, pc) => ({ pc, label: pc === SHARP_SPELL.length ? '' : (SHARP_SPELL[pc][1] ? `${LETTERS[SHARP_SPELL[pc][0]]}♯ / ${LETTERS[FLAT_SPELL[pc][0]]}♭` : LETTERS[SHARP_SPELL[pc][0]]) }));

/** Name of a chord, e.g. "D♭maj7", "C/E". */
export function chordName(rootPc, typeId, bassPc = null, pref = null) {
  const t = chordType(typeId);
  const sp = chordSpelling(rootPc, typeId, pref);
  const bass = bassPc !== null && pitchClass(bassPc) !== pitchClass(rootPc) ? `/${sp.get(pitchClass(bassPc))?.name ?? rootLabel(bassPc)}` : '';
  return rootLabel(rootPc, typeId, pref) + t.suffix + bass;
}

/** pc → { letter, acc, name, degree } for each chord tone, letter-correct (e.g. C♯ not D♭ in A major). */
export function chordSpelling(rootPc, typeId, pref = null) {
  const [rl] = rootSpell(rootPc, typeId, pref);
  const out = new Map();
  for (const [semi, deg] of chordType(typeId).tones) {
    const pc = pitchClass(rootPc + semi);
    const letter = (rl + deg - 1) % 7;
    const acc = ((pc - NATURAL_PC[letter] + 18) % 12) - 6;
    out.set(pc, { letter, acc, name: LETTERS[letter] + ACC[acc], degree: deg });
  }
  return out;
}
export const chordPcsOf = (rootPc, typeId) => new Set(chordType(typeId).tones.map(([s]) => pitchClass(rootPc + s)));

/**
 * Playable shapes for a chord in this tuning, best first. A shape: { frets: number[] (−1 = muted),
 * score, minFret, center }. Root in the bass; up to four fingers (or a barre plus three); a four-fret span.
 */
export function chordShapes(tuning, rootPc, typeId, maxFret = 22) {
  const t = chordType(typeId);
  const pcs = chordPcsOf(rootPc, typeId);
  const optPcs = new Set((t.opt || []).map((d) => pitchClass(rootPc + t.tones.find(([, deg]) => deg === d)[0])));
  const essential = [...pcs].filter((pc) => !optPcs.has(pc));
  const power = t.id === '5';
  const S = tuning.length;
  const seen = new Map();
  for (let base = 0; base <= maxFret - 3; base++) {
    const lo = Math.max(1, base), hi = base === 0 ? 4 : base + 3;
    const opts = tuning.map((open) => {
      const o = [-1];
      if (pcs.has(pitchClass(open)) && base <= 4) o.push(0);
      for (let f = lo; f <= Math.min(hi, maxFret); f++) if (pcs.has(pitchClass(open + f))) o.push(f);
      return o;
    });
    const cur = new Array(S);
    const walk = (s) => {
      if (s === S) { consider(cur.slice()); return; }
      for (const f of opts[s]) { cur[s] = f; walk(s + 1); }
    };
    walk(0);
  }
  function consider(frets) {
    const key = frets.join(',');
    if (seen.has(key)) return;
    const sounding = frets.map((f, s) => (f >= 0 ? s : -1)).filter((s) => s >= 0);
    if (sounding.length < (power ? 2 : 3)) return;
    const notes = sounding.map((s) => tuning[s] + frets[s]);
    if (pitchClass(Math.min(...notes)) !== pitchClass(rootPc)) return; // root in the bass (lowest pitch, not lowest string)
    const have = new Set(notes.map(pitchClass));
    if (!essential.every((pc) => have.has(pc))) return;
    const first = sounding[0], last = sounding[sounding.length - 1];
    let inner = 0;
    for (let s = first; s <= last; s++) if (frets[s] < 0) inner++;
    if (inner > 1) return;
    const trailing = S - 1 - last;
    const fretted = sounding.filter((s) => frets[s] > 0);
    const fs = fretted.map((s) => frets[s]);
    const minF = fs.length ? Math.min(...fs) : 0, maxF = fs.length ? Math.max(...fs) : 0;
    if (maxF - minF > 3) return;
    // fingers: one per fretted note, or a barre across the lowest fret plus one per note above it
    let fingers = fretted.length, barre = false;
    if (fingers > 4) {
      const from = sounding[0]; // a barre lies across the strings from the bass up
      const ok = frets[from] === minF && frets.every((f, s) => s < from || f >= minF || f < 0) && frets.slice(from).every((f) => f !== 0);
      if (!ok) return;
      barre = true;
      fingers = 1 + fretted.filter((s) => frets[s] > minF).length;
      if (fingers > 4) return;
    }
    const opens = sounding.length - fretted.length;
    const missing = [...pcs].filter((pc) => !have.has(pc)).length;
    // open strings are welcome in open position, awkward when the fretted notes are further up
    const openScore = maxF <= 3 ? -0.25 * opens : maxF >= 5 ? 0.25 * opens : 0;
    // an open string ringing between fretted ones is easy with a light hand shape (C: x32010), awkward
    // when the hand is stretched or every finger is busy
    const between = fretted.length ? sounding.filter((s) => frets[s] === 0 && s > fretted[0] && s < fretted[fretted.length - 1]).length : 0;
    const span = maxF - minF;
    const awkward = (between && (maxF >= 4 || (fingers >= 4 && span >= 2)) ? 1.3 * between : 0)
      + (fingers >= 4 && span >= 3 && !barre ? 0.6 * opens : 0);
    const score = minF * 0.22 + [0, 0.3, 0.7, 1.4][span] + (S - sounding.length) * (power ? 0.1 : 0.6)
      + openScore + awkward + inner * 2 + trailing * (power ? 0.1 : 1.2) + missing * 0.7
      + (barre ? 0.45 : 0) + fingers * 0.25 + (minF >= 12 ? 1 : 0);
    const center = fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : 0;
    seen.set(key, { frets, score, minFret: minF, center, barre });
  }
  return [...seen.values()].sort((a, b) => a.score - b.score);
}

/** A handful of shapes in different places on the neck: the best one first, then one per area, by position. */
export function distinctShapes(shapes, count = 6) {
  if (!shapes.length) return [];
  const chosen = [shapes[0]];
  for (const sh of shapes.slice(1)) {
    if (chosen.length >= count) break;
    if (chosen.every((c) => Math.abs(c.center - sh.center) >= 2.5)) chosen.push(sh);
  }
  const [best, ...rest] = chosen;
  return [best, ...rest.sort((a, b) => a.center - b.center)];
}

/**
 * Name the chord in these notes (MIDI). Returns null for fewer than two different notes.
 * { rootPc, typeId, bassPc, name, partial (some chord tone missing), notes: spelled names }
 */
export function identifyChord(midis) {
  if (!midis.length) return null;
  const sorted = [...midis].sort((a, b) => a - b);
  const bass = pitchClass(sorted[0]);
  const pcs = new Set(sorted.map(pitchClass));
  if (pcs.size < 2) return null;
  let best = null;
  CHORD_TYPES.forEach((t, order) => {
    for (const root of pcs) {
      const tonePcs = t.tones.map(([s]) => pitchClass(root + s));
      if (![...pcs].every((pc) => tonePcs.includes(pc))) continue; // a note outside the chord
      const missingDeg = t.tones.filter(([s]) => !pcs.has(pitchClass(root + s))).map(([, d]) => d);
      // allowed to leave out: the 5th (any chord); nothing else
      if (missingDeg.some((d) => d !== 5)) continue;
      if (t.id === '5' && pcs.size !== 2) continue;
      const score = (root === bass ? 0 : 2.5) + missingDeg.length * 1.2 + t.tones.length * 0.3 + order * 0.05;
      // "(no 5th)" only matters for a triad; four-note chords leave it out all the time
      if (!best || score < best.score) best = { rootPc: root, typeId: t.id, score, partial: missingDeg.length > 0 && !t.opt };
    }
  });
  if (!best) return { rootPc: null, typeId: null, bassPc: bass, name: null, partial: false };
  const sp = chordSpelling(best.rootPc, best.typeId);
  return {
    rootPc: best.rootPc, typeId: best.typeId, bassPc: bass, partial: best.partial,
    name: chordName(best.rootPc, best.typeId, bass) + (best.partial ? ' (no 5th)' : ''),
    notes: chordType(best.typeId).tones.filter(([semi]) => pcs.has(pitchClass(best.rootPc + semi))).map(([semi]) => sp.get(pitchClass(best.rootPc + semi)).name),
  };
}

/**
 * Common next chords from this one. Major chords as the home chord (I): V, IV, vi, ii. Minor as the home
 * minor chord (i): iv, V, ♭VI, ♭VII. Dominant 7ths resolve (I, i, or the deceptive vi). Diminished and
 * half-diminished lead up a semitone or to V. Each: { rootPc, typeId, label }.
 */
export function nextChords(rootPc, typeId) {
  const r = (n) => pitchClass(rootPc + n);
  const t = chordType(typeId);
  const minorish = ['min', 'm7', 'm6', 'm9'].includes(t.id);
  const dominant = ['7', '9', '7sus4'].includes(t.id);
  if (dominant) return [
    { rootPc: r(5), typeId: 'maj', label: 'I — resolves home' },
    { rootPc: r(5), typeId: 'min', label: 'i — resolves to minor' },
    { rootPc: r(2), typeId: 'min', label: 'vi — the surprise' },
    { rootPc: r(10), typeId: 'maj', label: '♭VII — steps down' },
  ];
  if (['dim', 'dim7', 'm7b5'].includes(t.id)) return [
    { rootPc: r(1), typeId: 'maj', label: 'up a semitone (I)' },
    { rootPc: r(1), typeId: 'min', label: 'up a semitone (i)' },
    { rootPc: r(5), typeId: '7', label: 'V7 — on to the dominant' },
  ];
  if (t.id === 'sus2' || t.id === 'sus4') return [
    { rootPc: r(0), typeId: 'maj', label: 'resolve the sus' },
    { rootPc: r(7), typeId: 'maj', label: 'V' },
    { rootPc: r(5), typeId: 'maj', label: 'IV' },
    { rootPc: r(9), typeId: 'min', label: 'vi' },
  ];
  if (minorish) return [
    { rootPc: r(5), typeId: 'min', label: 'iv' },
    { rootPc: r(7), typeId: 'maj', label: 'V — strong pull back' },
    { rootPc: r(8), typeId: 'maj', label: '♭VI' },
    { rootPc: r(10), typeId: 'maj', label: '♭VII' },
  ];
  return [
    { rootPc: r(7), typeId: 'maj', label: 'V — strong pull back' },
    { rootPc: r(5), typeId: 'maj', label: 'IV' },
    { rootPc: r(9), typeId: 'min', label: 'vi — relative minor' },
    { rootPc: r(2), typeId: 'min', label: 'ii' },
  ];
}

/** The shape of a chord closest on the neck to the given frets (for a progression that stays put). */
export function nearestShape(shapes, frets) {
  const fs = frets.filter((f) => f > 0);
  const center = fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : 0;
  let best = null, bestCost = Infinity;
  for (const sh of distinctShapes(shapes, 8)) { // only the standard shapes, as the chord library shows them
    const cost = Math.abs(sh.center - center) + sh.score * 0.3;
    if (cost < bestCost) { bestCost = cost; best = sh; }
  }
  return best;
}

/** Shape as text, low string first, e.g. "x32010". */
export const shapeText = (frets) => frets.map((f) => (f < 0 ? 'x' : f > 9 ? `(${f})` : String(f))).join('');

// ---------- Progressions: which key are you in, what each chord does there, where to go next ----------

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
// The three-note chord on each scale degree
const MAJOR_TRIADS = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
const MINOR_TRIADS = ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'];
const QUALITY = { maj: 'maj', '7': 'maj', maj7: 'maj', '6': 'maj', add9: 'maj', '9': 'maj', '5': 'maj', sus2: 'maj', sus4: 'maj', '7sus4': 'maj',
  min: 'min', m7: 'min', m6: 'min', m9: 'min', dim: 'dim', m7b5: 'dim', dim7: 'dim', aug: 'aug' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Does this chord belong to the key? (Minor keys also own the major V and diminished vii° of harmonic minor.) */
function inKey(ch, key) {
  const scale = (key.mode === 'major' ? MAJOR : MINOR).map((x) => pitchClass(key.tonic + x));
  const pcs = [...chordPcsOf(ch.rootPc, ch.typeId)];
  if (pcs.every((pc) => scale.includes(pc))) return true;
  if (key.mode === 'minor') { // harmonic minor: raised 7th, for V and vii°
    const raised = [...scale.slice(0, 6), pitchClass(key.tonic + 11)];
    const deg = (ch.rootPc - key.tonic + 12) % 12;
    if ((deg === 7 || deg === 11) && pcs.every((pc) => raised.includes(pc))) return true;
  }
  return false;
}
const isTonic = (ch, key) => pitchClass(ch.rootPc) === pitchClass(key.tonic) && QUALITY[ch.typeId] === (key.mode === 'major' ? 'maj' : 'min');
const keyName = (key) => `${rootLabel(key.tonic, key.mode === 'major' ? 'maj' : 'min')} ${key.mode}`;

/**
 * The key a progression is most likely in. Chords that fit the key count (recent ones more), plus a
 * tonic chord at the start or end, plus V→I cadences. Returns { tonic, mode, name, sure } —
 * `sure` once there's enough to go on and no close second.
 */
export function detectKey(prog) {
  if (!prog.length) return null;
  const n = prog.length;
  const scored = [];
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of ['major', 'minor']) {
    const key = { tonic, mode };
    let s = 0;
    prog.forEach((ch, i) => {
      const w = 0.6 + 0.4 * (i + 1) / n;
      if (inKey(ch, key)) s += w;
      else if (borrowedOrApplied(ch, key)) s += 0.3 * w;
    });
    if (isTonic(prog[0], key)) s += 0.4;
    if (isTonic(prog[n - 1], key)) s += 0.3;
    if (prog.some((ch) => isTonic(ch, key))) s += 0.3;
    for (let i = 1; i < n; i++) {
      const a = prog[i - 1], b = prog[i];
      if (isTonic(b, key) && pitchClass(a.rootPc - key.tonic) === 7 && QUALITY[a.typeId] === 'maj') s += 0.5; // V → I
      if (pitchClass(a.rootPc - key.tonic) === 2 && pitchClass(b.rootPc - key.tonic) === 7 && inKey(a, key) && inKey(b, key)) s += 0.3; // ii → V
    }
    // a dominant 7th on the fifth degree points straight at its key
    s += 0.3 * prog.filter((ch) => ['7', '9'].includes(ch.typeId) && pitchClass(ch.rootPc - key.tonic) === 7).length;
    if (mode === 'major') s += 0.05;
    scored.push({ ...key, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { tonic: best.tonic, mode: best.mode, name: keyName(best), sure: n >= 3 && best.score - scored[1].score >= 0.4 };
}

/** Borrowed from the parallel key (♭VI, ♭VII, iv in major…) or a secondary dominant (V of something). */
function borrowedOrApplied(ch, key) {
  return !!applied(ch, key) || inKey(ch, { tonic: key.tonic, mode: key.mode === 'major' ? 'minor' : 'major' });
}
/** If this chord is the V of another chord in the key, that chord's numeral ("vi" for E7 in C). */
function applied(ch, key) {
  if (QUALITY[ch.typeId] !== 'maj' || inKey(ch, key)) return null;
  const target = pitchClass(ch.rootPc + 5);
  const scale = key.mode === 'major' ? MAJOR : MINOR;
  const deg = scale.indexOf((target - key.tonic + 12) % 12);
  if (deg <= 0) return null; // V of I is just V
  const triad = (key.mode === 'major' ? MAJOR_TRIADS : MINOR_TRIADS)[deg];
  if (triad === 'dim') return null;
  return triad === 'min' ? ROMAN[deg].toLowerCase() : ROMAN[deg];
}

/** Roman numeral for a chord in a key: "vi", "V7", "♭VII", "iv", "V/vi", "ii°". */
export function numeral(ch, key) {
  const parallel = { tonic: key.tonic, mode: key.mode === 'major' ? 'minor' : 'major' };
  const sec = inKey(ch, parallel) ? null : applied(ch, key); // borrowed chords are named by degree (♭VII, iv)
  const t = chordType(ch.typeId);
  const ext = { '7': '7', maj7: 'maj7', m7: '7', '6': '6', m6: '6', add9: 'add9', '9': '9', m9: '9', sus2: 'sus2', sus4: 'sus4', '7sus4': '7sus4', m7b5: 'ø7', dim7: '°7', dim: '°', aug: '+', '5': '5' }[t.id] || '';
  if (sec) return `V${['7', '9'].includes(t.id) ? t.suffix : ''}/${sec}`;
  const { deg, acc } = degreeOf(ch.rootPc, key);
  const q = QUALITY[ch.typeId];
  const base = ROMAN[deg];
  return acc + (q === 'min' || q === 'dim' ? base.toLowerCase() : base) + ext;
}

/** Which degree of the key a root sits on: { deg 0–6, acc '' | '♭' | '♯' } (♭ preferred for notes outside the scale). */
function degreeOf(rootPc, key) {
  const off = (rootPc - key.tonic + 12) % 12;
  const scale = key.mode === 'major' ? MAJOR : MINOR;
  let deg = scale.indexOf(off), acc = '';
  if (deg < 0) {
    if (key.mode === 'minor' && off === 11) return { deg: 6, acc: '' }; // the raised 7th of harmonic minor
    if (key.mode === 'minor' && off === 9) return { deg: 5, acc: '♯' };
    deg = scale.indexOf((off + 1) % 12); acc = '♭';
    if (deg < 0) { deg = scale.indexOf((off + 11) % 12); acc = '♯'; }
  }
  return { deg, acc };
}

/** A chord's name spelled as the key would write it: B♭ (♭VII) in C, E♭ (♭VI) in G, G♯7 (V7/vi) in E. */
export function nameInKey(ch, key) {
  const [tl] = rootSpell(key.tonic, key.mode === 'major' ? 'maj' : 'min');
  const parallel = { tonic: key.tonic, mode: key.mode === 'major' ? 'minor' : 'major' };
  let letter;
  if (!inKey(ch, parallel) && applied(ch, key)) {
    const target = degreeOf(pitchClass(ch.rootPc + 5), key);
    letter = (tl + target.deg + 4) % 7; // a fifth above the chord it leads to
  } else letter = (tl + degreeOf(ch.rootPc, key).deg) % 7;
  const acc = ((pitchClass(ch.rootPc) - NATURAL_PC[letter] + 18) % 12) - 6;
  if (Math.abs(acc) > 1) return chordName(ch.rootPc, ch.typeId); // a double sharp/flat: use the plain name
  return LETTERS[letter] + ACC[acc] + chordType(ch.typeId).suffix;
}

// How often real songs go from one scale degree to the next (rough weights, from common practice)
const MOVES = {
  major: { 0: { 3: 0.3, 4: 0.3, 5: 0.25, 1: 0.15, 2: 0.05 }, 1: { 4: 0.6, 3: 0.1, 6: 0.1, 0: 0.1, 5: 0.1 }, 2: { 5: 0.5, 3: 0.3, 1: 0.1 },
    3: { 4: 0.35, 0: 0.3, 1: 0.15, 5: 0.1, 2: 0.05 }, 4: { 0: 0.55, 5: 0.25, 3: 0.15 }, 5: { 3: 0.4, 1: 0.25, 4: 0.2, 2: 0.1 }, 6: { 0: 0.7, 2: 0.2 } },
  minor: { 0: { 3: 0.25, 5: 0.25, 6: 0.2, 4: 0.15, 2: 0.1 }, 1: { 4: 0.7, 0: 0.2 }, 2: { 5: 0.35, 3: 0.3, 6: 0.2 },
    3: { 4: 0.35, 0: 0.3, 6: 0.2 }, 4: { 0: 0.7, 5: 0.25 }, 5: { 6: 0.35, 3: 0.25, 2: 0.2, 1: 0.1 }, 6: { 2: 0.4, 0: 0.35, 5: 0.15 } },
};
const DEGREE_ROLE = {
  major: ['home', 'leads to V', 'soft, leads to vi', 'moves away', 'pulls home', 'the relative minor', 'tense, wants I'],
  minor: ['home', 'leads to V', 'the relative major', 'moves away', 'pulls home', 'lifts', 'steps toward home'],
};

/** Diatonic chord on a degree of the key ({rootPc, typeId}); minor keys use the major V. */
function degreeChord(key, deg) {
  const scale = key.mode === 'major' ? MAJOR : MINOR;
  let typeId = (key.mode === 'major' ? MAJOR_TRIADS : MINOR_TRIADS)[deg];
  if (key.mode === 'minor' && deg === 4) typeId = 'maj'; // the major V pulls home harder
  return { rootPc: pitchClass(key.tonic + scale[deg]), typeId };
}

/**
 * Where to go next, in the key the progression is in. Up to three safe chords (in the key, ranked by how
 * often songs make that move), one with tension (the V7 of where you're likely heading), and one surprise
 * (borrowed from the parallel key). Each: { rootPc, typeId, name, numeral, group, why }.
 */
export function suggestNext(prog, key = detectKey(prog)) {
  if (!prog.length || !key) return [];
  const cur = prog[prog.length - 1];
  const scale = key.mode === 'major' ? MAJOR : MINOR;
  const same = (a, b) => pitchClass(a.rootPc) === pitchClass(b.rootPc) && (a.typeId === b.typeId || (QUALITY[a.typeId] === QUALITY[b.typeId] && ![a.typeId, b.typeId].some((t) => ['7', '9'].includes(t))));
  const out = [];
  const add = (ch, group, why) => {
    if (same(ch, cur) || out.some((o) => same(o, ch))) return;
    out.push({ ...ch, name: nameInKey(ch, key), numeral: numeral(ch, key), group, why });
  };

  // where the current chord sits: a scale degree, a V-of-something (resolve it), or borrowed (come back)
  const off = (cur.rootPc - key.tonic + 12) % 12;
  let deg = inKey(cur, key) ? scale.indexOf(off) : -1;
  if (deg < 0 && key.mode === 'minor' && off === 11) deg = 6;
  const sec = applied(cur, key);
  if (sec) {
    const target = { rootPc: pitchClass(cur.rootPc + 5), typeId: sec === sec.toLowerCase() ? 'min' : 'maj' };
    add(target, 'safe', `resolves the ${numeral(cur, key)}`);
  }
  const moves = deg >= 0 ? MOVES[key.mode][deg] : { 0: 0.5, 4: 0.3, 3: 0.2 }; // borrowed: head home or to V/IV
  Object.entries(moves).sort((a, b) => b[1] - a[1]).forEach(([d]) => {
    if (out.filter((o) => o.group === 'safe').length >= 3) return;
    const ch = degreeChord(key, Number(d));
    add(ch, 'safe', DEGREE_ROLE[key.mode][Number(d)]);
  });

  // tension: the dominant 7th of the most likely next chord (V7 if that's home, else V7/x)
  const goal = out.find((o) => o.group === 'safe' && !isTonic(o, key)) || degreeChord(key, 0);
  const dom = { rootPc: pitchClass(goal.rootPc + 7), typeId: '7' };
  add(dom, 'tension', `pushes into ${goal.name || nameInKey(goal, key)}`);
  if (!out.some((o) => o.group === 'tension')) add({ rootPc: pitchClass(key.tonic + 7), typeId: '7' }, 'tension', `pulls hard back to ${nameInKey(degreeChord(key, 0), key)}`);

  // surprise: a chord borrowed from the parallel key, chosen to suit where you are
  const borrow = key.mode === 'major'
    ? (deg === 3 ? [{ o: 5, t: 'min', why: 'borrowed minor iv — bittersweet' }] : deg === 4 || deg === 5 ? [{ o: 8, t: 'maj', why: 'borrowed ♭VI — big, cinematic' }] : [{ o: 10, t: 'maj', why: 'borrowed ♭VII — rock and roll' }, { o: 5, t: 'min', why: 'borrowed minor iv — bittersweet' }])
    : (deg === 0 ? [{ o: 5, t: 'maj', why: 'major IV — a brighter, Dorian lift' }] : [{ o: 1, t: 'maj', why: '♭II — dark and dramatic' }, { o: 5, t: 'maj', why: 'major IV — a brighter lift' }]);
  for (const b of borrow) { const before = out.length; add({ rootPc: pitchClass(key.tonic + b.o), typeId: b.t }, 'surprise', b.why); if (out.length > before) break; }
  return out;
}

/**
 * The shape for the next chord that's easiest to change to from `frets`: fingers move as little as
 * possible, shared notes stay put, and it's still a good shape. Returns { shape, stay: [{s,f}] }.
 */
export function easiestChange(shapes, frets) {
  if (!shapes.length) return null;
  const best = shapes[0].score;
  const sounding = frets.map((f) => f >= 0);
  const fs = frets.filter((f) => f > 0);
  const center = fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : 0;
  let pick = null, pickCost = Infinity;
  for (const sh of shapes.slice(0, 120)) {
    if (sh.score > best + 1.0) break;
    let cost = sh.score + Math.abs(sh.center - center) * 0.5;
    sh.frets.forEach((f, s) => {
      if (f >= 0 && sounding[s]) cost += f === frets[s] ? -0.8 : Math.abs(f - frets[s]) * 0.35;
      else if ((f >= 0) !== sounding[s]) cost += 0.25;
    });
    if (cost < pickCost) { pickCost = cost; pick = sh; }
  }
  const stay = pick.frets.map((f, s) => (f > 0 && f === frets[s] ? { s, f } : null)).filter(Boolean);
  return { shape: pick, stay };
}
