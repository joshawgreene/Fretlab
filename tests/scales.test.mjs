// Learn-mode scale logic. Run: node tests/scales.test.mjs
import { SCALES, buildPath, positions, scalePcs, scaleSpelling, rootName, keyPref } from '../js/scales.js';
import { parseNote, pitchClass } from '../js/notes.js';

const STD = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'].map(parseNote);
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const shape = (path) => [0, 1, 2, 3, 4, 5].map((s) => path.filter((n) => n.s === s).map((n) => n.f).join(',')).join(' | ');
const spelled = (root, id) => { const sp = scaleSpelling(root, id); return SCALES.find((s) => s.id === id).steps.map((st) => sp.get(pitchClass(root + st)).name).join(' '); };

// 1. Every scale's notes (intervals from the root), checked against the textbook definitions
const EXPECT = {
  major: 'C D E F G A B', minor: 'A B C D E F G', 'major-pent': 'C D E G A', 'minor-pent': 'A C D E G',
  blues: 'A C D E♭ E G', 'harmonic-minor': 'A B C D E F G♯', 'melodic-minor': 'A B C D E F♯ G♯',
  dorian: 'D E F G A B C', phrygian: 'E F G A B C D', lydian: 'F G A B C D E', mixolydian: 'G A B C D E F', locrian: 'B C D E F G A',
};
const ROOT_FOR = { major: 0, 'major-pent': 0, minor: 9, 'minor-pent': 9, blues: 9, 'harmonic-minor': 9, 'melodic-minor': 9, dorian: 2, phrygian: 4, lydian: 5, mixolydian: 7, locrian: 11 };
for (const [id, want] of Object.entries(EXPECT)) check(`${id} notes`, spelled(ROOT_FOR[id], id) === want, spelled(ROOT_FOR[id], id));

// 2. Spelling in other keys: every degree gets its own letter
check('F major has B♭', spelled(5, 'major') === 'F G A B♭ C D E');
check('E major', spelled(4, 'major') === 'E F♯ G♯ A B C♯ D♯');
check('D harmonic minor has C♯ (not D♭)', spelled(2, 'harmonic-minor') === 'D E F G A B♭ C♯', spelled(2, 'harmonic-minor'));
check('B♭ dorian', spelled(10, 'dorian') === 'B♭ C D♭ E♭ F G A♭', spelled(10, 'dorian'));
check('F♯ major has E♯', spelled(6, 'major') === 'F♯ G♯ A♯ B C♯ D♯ E♯', spelled(6, 'major'));
check('D♭ major (flat key)', rootName(1, 'major') === 'D♭' && spelled(1, 'major') === 'D♭ E♭ F G♭ A♭ B♭ C');
check('E blues has B♭ as the flat fifth', spelled(4, 'blues') === 'E G A B♭ B D', spelled(4, 'blues'));
check('C minor uses flats', keyPref(0, 'minor') === 'flat' && spelled(0, 'minor') === 'C D E♭ F G A♭ B♭');

// 3. Positions: the shapes guitarists actually use
{
  const p = positions(STD, 9, 'minor-pent');
  check('A minor pentatonic has 5 positions', p.length === 5);
  check('…Position 1 is the classic box at fret 5', shape(p[0].path) === '5,8 | 5,7 | 5,7 | 5,7 | 5,8 | 5,8', shape(p[0].path));
  check('…Position 2 is the box at frets 7–10', shape(p[1].path) === '8,10 | 7,10 | 7,10 | 7,9 | 8,10 | 8,10', shape(p[1].path));
  check('…Position 1 starts on the root', p[0].path[0].root && p[0].path[0].s === 0);
}
{
  const p = positions(STD, 4, 'minor-pent');
  check('E minor pentatonic Position 1 is the open box', shape(p[0].path) === '0,3 | 0,2 | 0,2 | 0,2 | 0,3 | 0,3', shape(p[0].path));
}
{
  const p = positions(STD, 0, 'major');
  check('C major has 7 three-notes-per-string positions', p.length === 7 && p.every((x) => x.path.length === 18));
  check('…Position 1 from the root at fret 8', shape(p[0].path) === '8,10,12 | 8,10,12 | 9,10,12 | 9,10,12 | 10,12,13 | 10,12,13', shape(p[0].path));
}
{
  const p = positions(STD, 4, 'major');
  check('E major Position 1 (open) is playable from the nut', shape(p[0].path) === '0,2,4 | 0,2,4 | 1,2,4 | 1,2,4 | 2,4,5 | 2,4,5', shape(p[0].path));
}
{
  const p = positions(STD, 9, 'blues');
  const pos1 = p[0].path;
  check('A blues has 5 positions', p.length === 5);
  check('…Position 1 = pentatonic box + the flat fifth', pos1.filter((n) => pitchClass(n.midi) === 3).length >= 2 && shape(pos1).startsWith('5,8 | 5,6,7'), shape(pos1));
}
// 4. Every scale × every root × every position: ascending, playable, only scale notes, within the neck
let bad = 0, total = 0;
for (const sc of SCALES) for (let r = 0; r < 12; r++) {
  const pcs = scalePcs(r, sc.id);
  for (const pos of positions(STD, r, sc.id)) {
    total++;
    const ok = pos.path.every((n, i) => (i === 0 || n.midi > pos.path[i - 1].midi) && n.f >= 0 && n.f <= 22 && pcs.has(pitchClass(n.midi)) && STD[n.s] + n.f === n.midi)
      && Math.max(...pos.path.map((n) => n.f)) - Math.min(...pos.path.map((n) => n.f)) <= 6;
    if (!ok) { bad++; if (bad < 4) console.log('  bad:', sc.id, r, pos.id, shape(pos.path)); }
  }
}
check(`All ${total} positions are ascending, in key, playable (≤ 6-fret stretch)`, bad === 0, bad ? `${bad} bad` : '');
// 5. Up & down
{
  const up = buildPath(STD, { rootPc: 7, scaleId: 'major', positionId: 'pos-1', direction: 'up' });
  const ud = buildPath(STD, { rootPc: 7, scaleId: 'major', positionId: 'pos-1', direction: 'updown' });
  check('Up & down = up + back down, top note once', ud.length === up.length * 2 - 1 && ud.at(-1).midi === up[0].midi);
  check('Unknown position falls back to Position 1', buildPath(STD, { rootPc: 7, scaleId: 'major', positionId: 'box-3' })[0].midi === up[0].midi);
}
console.log(failed ? `${failed} failed` : 'All scale tests passed');
process.exit(failed ? 1 : 0);
