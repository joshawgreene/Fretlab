// One-note music stave in guitar notation: treble clef with a small 8 below,
// i.e. written an octave higher than it sounds (the standard for guitar).
import { spell } from './notes.js';

const STEP = 5; // half a line-gap, in SVG units
const BOTTOM_LINE = 30; // E4 = octave 4 * 7 + letter 2
const LINES = [30, 32, 34, 36, 38];

// Normal: room for the full range. Compact (landscape phones): cropped tight to the clef and
// written 8va a little sooner, so the staff can be drawn much bigger in a short space.
const LAYOUTS = {
  normal: { top: 46, bottom: 21, pad: 12, width: 210, noteX: 140, ottavaAbove: 44 },
  compact: { top: 43, bottom: 21, pad: 5, width: 250, noteX: 165, ottavaAbove: 41 },
};
let L = LAYOUTS.normal;
const yOf = (step) => L.pad + (L.top - step) * STEP;

// Treble clef: one thick round-capped stroke (stem rising into the loop, then down the loop's right side
// and round the spiral), a short curl at the foot and a ball. Sized for a 10-unit line gap, with
// coordinates relative to the top staff line (y=0) .. bottom line (y=40); the spiral circles the G line.
export const CLEF = 'M 15.8 51 L 16.3 1 C 16.5 -6, 21.5 -14.5, 25 -13 C 28.5 -11.5, 26.5 -2.5, 21.5 4.5 '
  + 'C 17.5 10, 1 17.5, 0.8 30 C 0.6 40, 8.5 44.5, 15.5 44 C 23 43.5, 28 37.5, 27.4 31 '
  + 'C 26.8 23.5, 19.5 17.5, 13.2 21 C 8.2 24, 7.8 32, 11.8 35.2 '
  + 'M 15.8 51 C 15.6 56, 11.2 58.5, 7.6 56.6';

const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const ACC_GLYPH = { '-2': '𝄫', '-1': '♭', 1: '♯', 2: '𝄪' };

export function renderStave(host, midi, pref = 'sharp', { compact = false, spelled = null } = {}) {
  L = compact ? LAYOUTS.compact : LAYOUTS.normal;
  const WIDTH = L.width, HEIGHT = yOf(L.bottom) + L.pad, NOTE_X = L.noteX;
  const ledger = (y) => `<line class="st-ledger" x1="${NOTE_X - 13}" x2="${NOTE_X + 13}" y1="${y}" y2="${y}"/>`;
  let body = '';
  for (const s of LINES) body += `<line class="st-line" x1="6" x2="${WIDTH - 6}" y1="${yOf(s)}" y2="${yOf(s)}"/>`;
  body += `<line class="st-line" x1="6" x2="6" y1="${yOf(38)}" y2="${yOf(30)}"/>`;
  body += `<g class="st-clef-group" transform="translate(11 ${yOf(38)})"><path class="st-clef" d="${CLEF}"/>
           <circle class="st-clef-ball" cx="5.2" cy="54" r="4"/><text class="st-eight" x="16" y="70">8</text></g>`;

  let label = '';
  if (midi !== null && midi !== undefined) {
    let written = midi + 12; // guitar sounds an octave below written pitch
    let { letter, acc, octave } = spell(written, pref);
    if (spelled) { // the key's own spelling, e.g. C♯ rather than D♭, E♯ rather than F
      letter = spelled.letter; acc = spelled.acc;
      octave = Math.floor((written - acc - NATURAL_PC[letter]) / 12) - 1;
    }
    let step = octave * 7 + letter;
    let ottava = false;
    if (step > L.ottavaAbove) { step -= 7; ottava = true; } // very high: notate down an octave with 8va
    if (step < L.bottom) step = L.bottom; // below the guitar's range: clamp (shouldn't happen)
    const y = yOf(step);

    // Ledger lines
    for (let s = BOTTOM_LINE - 2; s >= step; s -= 2) body += ledger(yOf(s));
    for (let s = 40; s <= step; s += 2) body += ledger(yOf(s));

    // Whole-note head
    body += `<g class="st-note" transform="translate(${NOTE_X} ${y}) rotate(-22)">
               <ellipse rx="7.2" ry="4.9"/><ellipse class="st-hole" rx="3.6" ry="2.2" transform="rotate(-40)"/></g>`;
    if (acc) body += `<text class="st-acc" x="${NOTE_X - 15}" y="${y}" dy="0.33em">${ACC_GLYPH[acc]}</text>`;
    if (ottava) body += `<text class="st-8va" x="${NOTE_X + 15}" y="${yOf(L.top) + 9}">8va</text>`;
    label = ottava ? ' (written 8va)' : '';
  }

  host.innerHTML = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" class="stave-svg" role="img"
    aria-label="Stave${label}">${body}</svg>`;
}

