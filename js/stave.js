// One-note music stave in guitar notation: treble clef with a small 8 below,
// i.e. written an octave higher than it sounds (the standard for guitar).
import { spell } from './notes.js';

const STEP = 5; // half a line-gap, in SVG units
const TOP_STEP = 46; // highest diatonic step that fits (written A6)
const BOTTOM_STEP = 21; // lowest (written D3)
const PAD = 12;
const yOf = (step) => PAD + (TOP_STEP - step) * STEP;
const BOTTOM_LINE = 30; // E4 = octave 4 * 7 + letter 2
const LINES = [30, 32, 34, 36, 38];
const WIDTH = 210;
const HEIGHT = yOf(BOTTOM_STEP) + PAD;
const NOTE_X = 140;

// Treble clef drawn as a single stroked spiral, sized for a 10-unit line gap.
// Coordinates are relative to the top staff line (y=0) .. bottom line (y=40).
const CLEF = `
  M 17.5 61
  C 12 63, 7 59, 10 55
  C 13 51, 19 55, 15.5 59
  M 16 60
  L 19 -14
  C 20 -24, 30 -22, 27 -10
  C 24.5 0, 6 10, 5 25
  C 4 37, 16 42, 25 37
  C 33 32, 30 19, 21 19
  C 13 19, 11 29, 17 31`;

export function renderStave(host, midi, pref = 'sharp') {
  let body = '';
  for (const s of LINES) body += `<line class="st-line" x1="6" x2="${WIDTH - 6}" y1="${yOf(s)}" y2="${yOf(s)}"/>`;
  body += `<line class="st-line" x1="6" x2="6" y1="${yOf(38)}" y2="${yOf(30)}"/>`;
  body += `<g transform="translate(10 ${yOf(38)})"><path class="st-clef" d="${CLEF}"/>
           <text class="st-eight" x="10" y="78">8</text></g>`;

  let label = '';
  if (midi !== null && midi !== undefined) {
    let written = midi + 12; // guitar sounds an octave below written pitch
    let { letter, acc, octave } = spell(written, pref);
    let step = octave * 7 + letter;
    let ottava = false;
    if (step > 44) { step -= 7; ottava = true; } // very high: notate down an octave with 8va
    if (step < BOTTOM_STEP) step = BOTTOM_STEP; // below the guitar's range: clamp (shouldn't happen)
    const y = yOf(step);

    // Ledger lines
    for (let s = BOTTOM_LINE - 2; s >= step; s -= 2) body += ledger(yOf(s));
    for (let s = 40; s <= step; s += 2) body += ledger(yOf(s));

    // Whole-note head
    body += `<g class="st-note" transform="translate(${NOTE_X} ${y}) rotate(-22)">
               <ellipse rx="7.2" ry="4.9"/><ellipse class="st-hole" rx="3.6" ry="2.2" transform="rotate(-40)"/></g>`;
    if (acc) body += `<text class="st-acc" x="${NOTE_X - 15}" y="${y}" dy="0.33em">${acc > 0 ? '♯' : '♭'}</text>`;
    if (ottava) body += `<text class="st-8va" x="${NOTE_X - 14}" y="${yOf(46) + 2}">8va</text>`;
    label = ottava ? ' (written 8va)' : '';
  }

  host.innerHTML = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" class="stave-svg" role="img"
    aria-label="Stave${label}">${body}</svg>`;
}

const ledger = (y) => `<line class="st-ledger" x1="${NOTE_X - 13}" x2="${NOTE_X + 13}" y1="${y}" y2="${y}"/>`;
