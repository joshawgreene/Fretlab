// Learn-mode scale logic. Run: node tests/scales.test.mjs
import { buildPath, positions, scalePcs, rootName, keyPref } from '../js/scales.js';
import { parseNote, noteLabel } from '../js/notes.js';

const STD = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'].map(parseNote);
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const labels = (path, pref = 'sharp') => path.map((p) => noteLabel(p.midi, pref)).join(' ');

// Spelling
check('F major uses flats', keyPref(5, 'major') === 'flat' && rootName(10, 'major') === 'B♭');
check('E minor uses sharps', keyPref(4, 'minor') === 'sharp');
check('D minor uses flats (relative of F)', keyPref(2, 'minor') === 'flat');
check('A minor pentatonic = A C D E G', [...scalePcs(9, 'minor-pent')].sort((a, b) => a - b).join() === '0,2,4,7,9');

// C major, open position: the classic open C major scale shape
{
  const p = buildPath(STD, { rootPc: 0, scaleId: 'major', positionId: 'box-0', frets: 22, direction: 'up' });
  const got = labels(p);
  check('C major open position', got === 'E2 F2 G2 A2 B2 C3 D3 E3 F3 G3 A3 B3 C4 D4 E4 F4 G4', got);
  check('…uses open B string, not G string fret 4', p.find((n) => n.midi === parseNote('B3')).s === 4);
}
// Every step ascends and stays inside its box
{
  const p = buildPath(STD, { rootPc: 9, scaleId: 'minor-pent', positionId: 'box-4', frets: 22, direction: 'up' });
  check('A minor pentatonic box at fret 4–8 ascends', p.every((n, i) => i === 0 || n.midi > p[i - 1].midi), labels(p));
  check('…stays within frets 4–8', p.every((n) => n.f >= 4 && n.f <= 8));
  check('…starts on the root (A2, 5th fret low E)', p[0].midi === parseNote('A2') && p[0].f === 5 && p[0].root);
}
// Up & down doesn't repeat the top note
{
  const up = buildPath(STD, { rootPc: 7, scaleId: 'major', positionId: 'box-2', frets: 22, direction: 'up' });
  const ud = buildPath(STD, { rootPc: 7, scaleId: 'major', positionId: 'box-2', frets: 22, direction: 'updown' });
  check('Up & down = up + back down, top note once', ud.length === up.length * 2 - 1 && ud.at(-1).midi === up[0].midi);
  check('No two notes in a row are the same pitch', ud.every((n, i) => i === 0 || n.midi !== ud[i - 1].midi));
}
// Whole neck: two octaves from the lowest root, playable steps
{
  const p = buildPath(STD, { rootPc: 7, scaleId: 'major', positionId: 'neck', frets: 22, direction: 'up' });
  check('G major neck path spans two octaves from G2', p[0].midi === parseNote('G2') && p.at(-1).midi === parseNote('G4') && p.length === 15, labels(p));
  check('…no big jumps along the neck', p.every((n, i) => i === 0 || Math.abs(n.f - p[i - 1].f) <= 5));
}
// Positions list
{
  const pos = positions(STD, 0, 22).map((x) => x.id);
  check('C positions include neck, open, and boxes under each low root', pos[0] === 'neck' && pos.includes('box-0') && pos.includes('box-7') && pos.includes('box-2'), pos.join(' '));
}
console.log(failed ? `${failed} failed` : 'All scale tests passed');
process.exit(failed ? 1 : 0);
