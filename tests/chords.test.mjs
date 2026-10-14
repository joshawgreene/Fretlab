// Chord mode. Run: node tests/chords.test.mjs
// Shapes match the standard chord charts, every shape is playable and correct, drawn chords are named
// right (including slash chords), next-chord suggestions are sensible and use standard shapes.
import { chordShapes, distinctShapes, shapeText, identifyChord, nextChords, nearestShape, chordName, chordSpelling, CHORD_TYPES, chordPcsOf, detectKey, numeral, suggestNext, easiestChange } from '../js/chords.js';
import { pitchClass } from '../js/notes.js';

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
const STD = [40, 45, 50, 55, 59, 64];
const PC = { C: 0, 'C♯': 1, 'D♭': 1, D: 2, 'E♭': 3, E: 4, F: 5, 'F♯': 6, G: 7, 'A♭': 8, A: 9, 'B♭': 10, B: 11 };

// 1. The first shape offered is the one on the chord charts (alternatives that are just as standard allowed)
const CHARTS = {
  'C maj': 'x32010', 'A maj': 'x02220', 'G maj': '320003|320033', 'E maj': '022100', 'D maj': 'xx0232', 'F maj': '133211', 'B♭ maj': 'x13331',
  'B maj': 'x24442', 'F♯ maj': '244322', 'A♭ maj': '466544', 'A min': 'x02210', 'E min': '022000', 'D min': 'xx0231', 'B min': 'x24432',
  'F♯ min': '244222', 'C min': 'x35543', 'F min': '133111', 'E 7': '020100', 'A 7': 'x02020', 'D 7': 'xx0212', 'G 7': '320001',
  'C 7': 'x32310', 'B 7': 'x21202', 'A maj7': 'x02120', 'C maj7': 'x32000', 'D maj7': 'xx0222', 'G maj7': '320002',
  'F maj7': 'xx3210|102210', 'A m7': 'x02010', 'E m7': '020000|022030', 'D m7': 'xx0211', 'D sus4': 'xx0233', 'A sus2': 'x02200',
  'D sus2': 'xx0230', 'E sus4': '022200|002200', 'A sus4': 'x02230|x00230', 'C 6': 'x32210', 'A m6': 'x02212', 'D 7sus4': 'xx0213',
};
let chart = 0;
for (const [k, want] of Object.entries(CHARTS)) {
  const [r, t] = k.split(' ');
  const got = shapeText(chordShapes(STD, PC[r], t)[0]?.frets ?? []);
  const ok = want.split('|').includes(got);
  if (ok) chart++; else console.log(`     ${k}: got ${got}, chart says ${want}`);
}
check(chart === Object.keys(CHARTS).length, `first shape matches the chord charts: ${chart} of ${Object.keys(CHARTS).length}`);

// 2. Every shape of every chord in every key: right notes, root in the bass, playable
let bad = 0, total = 0, thin = [];
for (const t of CHORD_TYPES) for (let r = 0; r < 12; r++) {
  const shapes = chordShapes(STD, r, t.id);
  const shown = distinctShapes(shapes);
  if (shown.length < 3) thin.push(chordName(r, t.id));
  const pcs = chordPcsOf(r, t.id);
  const essential = t.tones.filter(([, d]) => !(t.opt || []).includes(d)).map(([s]) => pitchClass(r + s));
  for (const sh of shown) {
    total++;
    const notes = sh.frets.map((f, s) => (f < 0 ? null : STD[s] + f)).filter((x) => x !== null);
    const fretted = sh.frets.filter((f) => f > 0);
    const ok = notes.every((m) => pcs.has(pitchClass(m))) && essential.every((pc) => notes.some((m) => pitchClass(m) === pc))
      && pitchClass(Math.min(...notes)) === pitchClass(r) && (Math.max(...fretted, 0) - Math.min(...fretted, 99) <= 3 || !fretted.length);
    if (!ok) { bad++; if (bad < 4) console.log('     bad:', chordName(r, t.id), shapeText(sh.frets)); }
  }
}
check(bad === 0, `all ${total} shapes shown: only chord tones, every essential tone, root in the bass, ≤ 4-fret span`);
check(thin.length === 0, `every chord in every key has at least 3 places to play it${thin.length ? ' — not: ' + thin.join(' ') : ''}`);

// 3. Naming a drawn chord
const notesOf = (sh) => sh.split('').map((c, s) => (c === 'x' ? null : STD[s] + Number(c))).filter((x) => x !== null);
const NAMES = {
  x32010: 'C', '022000': 'Em', xx0232: 'D', '320001': 'G7', x02120: 'Amaj7', '032010': 'C/E', '3x0003': 'G', xx0211: 'Dm7',
  x21202: 'B7', x02200: 'Asus2', '022xxx': 'E5', xx0101: 'Ddim7', '133211': 'F', x46654: 'C♯m', '466544': 'A♭', 'xx4232': 'D/F♯',
  x35543: 'Cm', '320000': 'G6', x02210: 'Am', 'x0221x': 'Am', xx3210: 'Fmaj7', xx3111: 'Fm', 'x3x45x': 'Cmaj7', 'x32xxx': 'C (no 5th)', '002200': 'Esus4', x24242: 'B7', xx0202: 'D6',
};
let named = 0;
for (const [sh, want] of Object.entries(NAMES)) {
  const id = identifyChord(notesOf(sh));
  if (id?.name === want) named++; else console.log(`     ${sh}: named ${id?.name}, should be ${want}`);
}
check(named === Object.keys(NAMES).length, `drawn chords named correctly: ${named} of ${Object.keys(NAMES).length}`);
check(identifyChord(notesOf('xxx2xx')) === null && identifyChord([]) === null, 'one note is not a chord');
check(identifyChord(notesOf('x00010')).name === null, 'an unusual cluster gets no made-up name');
check(identifyChord(notesOf('x32010')).notes.join(' ') === 'C E G' && identifyChord(notesOf('xx0232')).notes.join(' ') === 'D F♯ A', 'notes listed root upward, spelled for the key');

// 4. Next chords
const nx = (root, t) => nextChords(root, t).map((n) => chordName(n.rootPc, n.typeId)).join(' ');
check(nx(0, 'maj') === 'G F Am Dm', `C → ${nx(0, 'maj')} (V, IV, vi, ii)`);
check(nx(9, 'min') === 'Dm E F G', `Am → ${nx(9, 'min')} (iv, V, ♭VI, ♭VII)`);
check(nx(7, '7').startsWith('C Cm Am'), `G7 → ${nx(7, '7')} (resolves to C)`);
check(nx(4, 'maj') === 'B A C♯m F♯m', `E → ${nx(4, 'maj')} (spelled with sharps, as E major is)`);
const near = nearestShape(chordShapes(STD, 7, 'min'), [-1, -1, 0, 2, 1, 1]); // from Dm7 to Gm
check(shapeText(near.frets) === '355333', `next-chord shapes are standard ones nearby (Dm7 → Gm ${shapeText(near.frets)})`);
const fromBarre = nearestShape(chordShapes(STD, 7, 'maj'), [8, 10, 10, 9, 8, 8]); // from C at the 8th fret to G
check(Math.abs(fromBarre.center - 9) <= 3, `…and stay in the same area of the neck (C at fret 8 → G ${shapeText(fromBarre.frets)})`);

// 5. Spelling
const sp = (r, t) => [...chordSpelling(r, t).values()].map((x) => x.name).join(' ');
check(sp(1, 'maj') === 'D♭ F A♭' && sp(8, 'min') === 'G♯ B D♯' && sp(0, 'dim7') === 'C E♭ G♭ B𝄫' && sp(6, '7') === 'F♯ A♯ C♯ E', 'chord tones spelled letter by letter (B𝄫 in Cdim7)');

// 6. Other tunings
const DROPD = [38, 45, 50, 55, 59, 64];
const dd = chordShapes(DROPD, 2, '5')[0];
check(dd && shapeText(dd.frets).startsWith('000'), `drop D: D5 is the open low strings (${shapeText(dd.frets)})`);

// 7. Progressions: the key, what each chord does, where to go next
const P = { C: 0, 'C♯': 1, 'D♭': 1, D: 2, 'E♭': 3, E: 4, F: 5, 'F♯': 6, G: 7, 'A♭': 8, A: 9, 'B♭': 10, B: 11 };
const prog = (str) => str.split(' ').map((c) => { const m = c.match(/^([A-G][♯♭]?)(.*)$/); return { rootPc: P[m[1]], typeId: { '': 'maj', m: 'min', 7: '7', m7: 'm7', maj7: 'maj7' }[m[2]] }; });
const KEYS = { 'C Am F': 'C major', 'G C D': 'G major', 'D A Bm G': 'D major', 'E A B7': 'E major', 'C F G7 C': 'C major', 'Am Dm E7': 'A minor',
  'Dm7 G7': 'C major', 'B♭ E♭ F': 'B♭ major', 'F♯m D A E': 'F♯ minor', 'C': 'C major', 'Am': 'A minor' };
let keysRight = 0;
for (const [p, want] of Object.entries(KEYS)) { const k = detectKey(prog(p)); if (k.name === want) keysRight++; else console.log(`     ${p}: ${k.name}, should be ${want}`); }
check(keysRight === Object.keys(KEYS).length, `key found from the progression: ${keysRight} of ${Object.keys(KEYS).length} (incl. ii–V → C, harmonic-minor V7 → A minor)`);
check(detectKey(prog('G C D')).sure && !detectKey(prog('C')).sure, 'says when it\'s sure (three clear chords) and when it\'s guessing (one chord)');
const num = (p) => { const pr = prog(p), k = detectKey(pr); return pr.map((c) => numeral(c, k)).join(' '); };
check(num('C Am F G7') === 'I vi IV V7' && num('Am Dm E7') === 'i iv V7' && num('Dm7 G7') === 'ii7 V7', `roman numerals: ${num('C Am F G7')} · ${num('Am Dm E7')} · ${num('Dm7 G7')}`);
const kc = { tonic: 0, mode: 'major' };
check(numeral({ rootPc: 4, typeId: '7' }, kc) === 'V7/vi' && numeral({ rootPc: 10, typeId: 'maj' }, kc) === '♭VII' && numeral({ rootPc: 5, typeId: 'min' }, kc) === 'iv' && numeral({ rootPc: 11, typeId: 'dim' }, kc) === 'vii°',
  'in C: E7 = V7/vi, B♭ = ♭VII, Fm = iv (borrowed), B° = vii°');
const sug = (p) => suggestNext(prog(p));
const s1 = sug('C Am F');
check(s1.filter((x) => x.group === 'safe').map((x) => x.name).join(' ') === 'G C Dm', `after C Am F (I vi IV): safe = ${s1.filter((x) => x.group === 'safe').map((x) => x.name).join(' ')} (V, I, ii)`);
check(s1.some((x) => x.group === 'tension' && x.name === 'D7') && s1.some((x) => x.group === 'surprise' && x.name === 'Fm'), 'tension D7 (V of V), surprise Fm (borrowed iv after IV)');
check(sug('C E7')[0].name === 'Am', 'a secondary dominant resolves first (E7 → Am)');
check(sug('Am Dm E7').find((x) => x.group === 'safe').name === 'Am', 'V7 in A minor → back to Am');
const names = (p) => sug(p).map((x) => x.name).join(' ');
check(names('C').includes('B♭') && names('G C D').includes('E♭') && names('E A B7').includes('G♯7') && names('B♭ E♭ F').includes('G♭'), 'suggestions spelled by their degree in the key (B♭ in C, E♭ in G, G♯7 in E, G♭ in B♭)');
check(['G C D', 'Am Dm E7', 'C', 'E A B7'].every((p) => { const g = sug(p).map((x) => x.group); return g.includes('safe') && g.includes('tension') && g.includes('surprise') && g.length <= 5; }), 'always some safe, one tension and one surprise idea (at most five)');
const ch = easiestChange(chordShapes(STD, 9, 'min'), [-1, 3, 2, 0, 1, 0]); // C → Am
check(shapeText(ch.shape.frets) === 'x02210' && ch.stay.length === 2, `easiest change keeps fingers in place: C → Am ${shapeText(ch.shape.frets)}, ${ch.stay.length} fingers stay`);
const ch2 = easiestChange(chordShapes(STD, 5, 'maj'), [-1, 0, 2, 2, 1, 0]); // Am → F
check(['xx3211', '133211'].includes(shapeText(ch2.shape.frets)) && ch2.stay.length === 2, `Am → F ${shapeText(ch2.shape.frets)} (a standard shape), ${ch2.stay.length} fingers stay`);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
