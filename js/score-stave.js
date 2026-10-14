// Play mode: draws bars of an imported piece on a treble-8 (guitar) stave — clef, key and time
// signatures, notes with stems, flags and beams, dots, ties, rests, accidentals, ledger lines.
// The note to play is drawn in the mode colour, the one after it ghosted, notes already played greyed.
import { CLEF } from './stave.js';

const STEP = 5;                     // half a line-gap
const LINES = [30, 32, 34, 36, 38]; // E4 .. F5 (written)
const MIDDLE = 34;                  // B4: stems flip here
const STEM = 33;
const ACC = { '-2': '𝄫', '-1': '♭', 0: '♮', 1: '♯', 2: '𝄪' };
const SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34]; // F C G D A E B
const FLAT_STEPS = [34, 37, 33, 36, 32, 35, 31];  // B E A D G C F
const KEY_LETTERS_SHARP = [3, 0, 4, 1, 5, 2, 6];
const KEY_LETTERS_FLAT = [6, 2, 5, 1, 4, 0, 3];
const BEATS = { maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625 };
const FLAGS = { eighth: 1, '16th': 2, '32nd': 3, '64th': 4 };

const stepOf = (p) => p.octave * 7 + p.letter;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Vertical extent of the whole piece, so the stave doesn't jump about from bar to bar. */
export function scoreRange(score) {
  let lo = 30, hi = 38;
  for (const m of score.measures) for (const n of m.notes) for (const p of n.pitches) { lo = Math.min(lo, stepOf(p)); hi = Math.max(hi, stepOf(p)); }
  return { top: Math.min(54, Math.max(44, hi + 4)), bottom: Math.max(14, Math.min(22, lo - 3)) };
}

/** Which bars to show: one bar, or the line of four it sits in. */
export function barWindow(score, m, wide) {
  const count = wide ? 4 : 1;
  const start = Math.floor(m / count) * count;
  return { start, count: Math.min(count, score.measures.length - start) };
}

/**
 * @param {HTMLElement} host
 * @param {object} score  from readScore()
 * @param {{start:number, count:number, cur?:{m,n}|null, next?:{m,n}|null, minWidth?:number, fit?:{w:number,h:number}}} view
 *   fit: the box it's drawn in — the bars are spread to match its shape, so the stave fills it
 */
export function renderScore(host, score, { start, count, cur = null, next = null, minWidth = 230, fit = null, single = false, labels = false, frame = null, scale = null, box = null }) {
  // scale (px per unit) + box (the space available): draw at that one size, shrinking only if it won't fit
  // frame: { top, bottom, pad } — the same vertical frame as the one-note stave in the other modes, so the
  // stave is drawn at one size everywhere (it only grows for a note too high or low to fit)
  // labels: a chord progression — each bar's chord name above it (m.label) and its numeral below (m.sub),
  // no bar numbers, and no final barline (the progression carries on)
  let range = scoreRange(score);
  let pad = 8;
  if (frame) {
    const r = range;
    range = { top: Math.max(frame.top, r.top - 4 + 2), bottom: Math.min(frame.bottom, r.bottom + 3 - 2) }; // only grow when a note needs it
    pad = frame.pad;
  }
  // room above the stave for section marks and 1st/2nd-ending brackets, if the piece has any
  const markRoom = frame ? 0 : labels ? 24 : !single && score.measures.some((m) => m.marks?.length || m.ending) ? 22 : 0;
  const subRoom = frame ? 0 : labels ? 16 : 0;
  const y = (s) => pad + markRoom + (range.top - s) * STEP;
  const H = y(range.bottom) + pad + subRoom;
  // which bars sit under a 1st/2nd-ending bracket (it can start before the bars shown)
  const endings = [];
  { let cur = null; score.measures.forEach((m, i) => { if (m.ending) cur = m.ending; endings[i] = cur ? { label: cur, starts: !!m.ending, stops: m.endingStop === 'stop' } : null; if (m.endingStop) cur = null; }); }
  if (fit && fit.w > 0 && fit.h > 0) minWidth = Math.max(minWidth, H * fit.w / fit.h);
  const order = (m, n) => m * 10000 + n;
  const curKey = cur ? order(cur.m, cur.n) : -1;
  const nextKey = next ? order(next.m, next.n) : -1;

  // ---- horizontal layout ----
  const first = score.measures[start];
  const keySig = first.key;
  let x = 6;
  const head = { clefX: x + 7 };
  x += 40;
  head.keyX = x;
  x += Math.abs(keySig) * 8 + (keySig ? 6 : 0);
  const showTime = first.timeChanged;
  head.timeX = x + 9;
  if (showTime) x += 24;
  const bars = [];
  for (let b = start; b < start + count; b++) {
    const m = score.measures[b];
    const bar = { m, b, x0: x, items: [] };
    let bx = 12 + (m.repeatStart ? 12 : 0); // room for a start-repeat sign
    if (b > start && m.keyChanged) { bar.keyAt = bx; bx += Math.abs(m.key) * 8 + 10; }
    if (b > start && m.timeChanged) { bar.timeAt = bx + 9; bx += 32; }
    const notes = [...m.notes].map((n, i) => ({ n, i })).sort((a, b2) => a.n.start - b2.n.start);
    const accState = keyAlters(m.key);
    for (const { n, i } of notes) {
      const beats = BEATS[n.type] ?? n.beats ?? 1;
      const acc = [];
      for (const p of n.pitches) {
        const k = `${p.letter}${p.octave}`;
        const cur0 = accState[k] ?? accState[p.letter] ?? 0;
        if (p.alter !== cur0) { acc.push(p.alter); accState[k] = p.alter; } else acc.push(null);
      }
      const accW = acc.some((a) => a !== null) ? 10 : 0;
      const w = labels ? 30 : n.wholeBarRest ? 40 : 12 + 20 * Math.sqrt(beats) + (n.dots ? 5 : 0);
      bar.items.push({ n, i, rel: bx + accW, acc, w });
      bx += accW + w;
    }
    bar.inner = bx + 6 + (m.repeatEnd ? 12 : 0);
    bars.push(bar);
    x += bar.inner;
  }
  // stretch to the minimum width
  const natural = x + 4;
  const barsFrom = bars[0]?.x0 ?? x;
  const sumInner = bars.reduce((a, b) => a + b.inner, 0) || 1;
  // spread out to fill the width; or, drawing at a fixed size, squeeze the notes a little rather than shrink the stave
  const room = scale && box ? box.w / scale - 2 : Infinity;
  const stretch = natural < minWidth ? (minWidth - 4 - barsFrom) / sumInner
    : natural > room ? Math.max(0.6, (room - 4 - barsFrom) / sumInner) : 1;
  let bx0 = barsFrom;
  for (const bar of bars) {
    bar.x0 = bx0;
    for (const it of bar.items) it.x = bar.x0 + it.rel * stretch;
    bar.x1 = bar.x0 + bar.inner * stretch;
    if (bar.items.length === 1 && bar.items[0].n.wholeBarRest) bar.items[0].x = (bar.x0 + bar.x1) / 2;
    bx0 = bar.x1;
  }
  const W = Math.max(barsFrom + sumInner * stretch + 4, Math.min(minWidth, room)) + 2;

  // ---- drawing ----
  let svg = '', bands = ''; // bands: the highlight behind the note to play, drawn under everything
  const lineEnd = bars.length ? bars[bars.length - 1].x1 : W - 6;
  for (const s of LINES) svg += `<line class="st-line" x1="6" x2="${lineEnd}" y1="${y(s)}" y2="${y(s)}"/>`;
  svg += `<line class="st-line" x1="6" x2="6" y1="${y(38)}" y2="${y(30)}"/>`;
  svg += `<g class="st-clef-group" transform="translate(${head.clefX} ${y(38)})"><path class="st-clef" d="${CLEF}"/>
          <circle class="st-clef-ball" cx="5.2" cy="54" r="4"/><text class="st-eight" x="16" y="70">8</text></g>`;
  svg += keySignature(keySig, head.keyX, y);
  if (showTime) svg += timeSignature(first.time, head.timeX, y);
  let hits = ''; // invisible tap areas, on top of everything: whole bars, then single notes
  for (const bar of bars) {
    if (single) break;
    const m = bar.m;
    hits += `<rect class="sc-hit" data-bar="${bar.b}" x="${bar.x0}" y="0" width="${Math.max(1, bar.x1 - bar.x0)}" height="${H}"/>`;
    if (m.ottava && bar.items[0]) svg += `<text class="st-8va" x="${bar.items[0].x + 9}" y="${y(Math.max(...bar.items[0].n.pitches.map(stepOf))) - 6}">8va</text>`;
    if (labels) {
      const cx = bar.items[0] ? bar.items[0].x : (bar.x0 + bar.x1) / 2;
      const state = bar.b === cur?.m ? ' cur' : bar.b === next?.m ? ' next' : '';
      if (m.label) svg += `<text class="sc-chord${state}" x="${cx}" y="${pad + 14}">${esc(m.label)}</text>`;
      if (m.sub) svg += `<text class="sc-sub${state}" x="${cx}" y="${H - pad + 2}">${esc(m.sub)}</text>`;
    } else svg += `<text class="sc-barnum" x="${bar.x0 + 3}" y="${y(38) - 8}">${m.number}</text>`;
    // section marks: rehearsal letters boxed, section names in bold italics
    let mx = bar.x0 + 4;
    for (const mk of m.marks || []) {
      if (mk.type === 'rehearsal') {
        const w = 8 + mk.text.length * 8;
        svg += `<rect class="sc-reh" x="${mx}" y="${pad - 2}" width="${w}" height="16"/><text class="sc-reh-t" x="${mx + w / 2}" y="${pad + 10}">${esc(mk.text)}</text>`;
        mx += w + 6;
      } else {
        svg += `<text class="sc-mark" x="${mx}" y="${pad + 10}">${esc(mk.text)}</text>`;
        mx += mk.text.length * 6.5 + 8;
      }
    }
    // 1st / 2nd ending bracket
    const en = endings[bar.b];
    if (en) {
      const yv = pad + markRoom - 4;
      svg += `<path class="sc-volta" d="M${bar.x0 + 2} ${en.starts ? yv + 9 : yv} L${bar.x0 + 2} ${yv} L${bar.x1 - 3} ${yv}${en.stops ? ` L${bar.x1 - 3} ${yv + 9}` : ''}"/>`;
      if (en.starts) svg += `<text class="sc-volta-t" x="${bar.x0 + 6}" y="${yv + 10}">${esc(en.label.split(',').join('., '))}.</text>`;
    }
    // repeat signs
    const dots = (x) => `<circle class="sc-dot-r" cx="${x}" cy="${y(35)}" r="1.9"/><circle class="sc-dot-r" cx="${x}" cy="${y(33)}" r="1.9"/>`;
    if (m.repeatStart) svg += `<rect class="sc-final" x="${bar.x0}" y="${y(38)}" width="3.5" height="${y(30) - y(38)}"/><line class="st-line" x1="${bar.x0 + 6}" x2="${bar.x0 + 6}" y1="${y(38)}" y2="${y(30)}"/>${dots(bar.x0 + 10)}`;
    if (m.repeatEnd) svg += `${dots(bar.x1 - 10)}<line class="st-line" x1="${bar.x1 - 6}" x2="${bar.x1 - 6}" y1="${y(38)}" y2="${y(30)}"/><rect class="sc-final" x="${bar.x1 - 3.5}" y="${y(38)}" width="3.5" height="${y(30) - y(38)}"/>`;
    else if (m.barStyle === 'light-light') svg += `<line class="st-line" x1="${bar.x1 - 4}" x2="${bar.x1 - 4}" y1="${y(38)}" y2="${y(30)}"/>`;
  }

  for (const bar of bars) {
    if (bar.keyAt !== undefined) svg += keySignature(bar.m.key, bar.x0 + bar.keyAt * stretch, y);
    if (bar.timeAt !== undefined) svg += timeSignature(bar.m.time, bar.x0 + bar.timeAt * stretch, y);
    const last = bar.b === score.measures.length - 1;
    if (single) { /* a lone chord: no barlines */ } else if (last && !labels) svg += `<line class="st-line" x1="${bar.x1 - 7}" x2="${bar.x1 - 7}" y1="${y(38)}" y2="${y(30)}"/>`
      + `<rect class="sc-final" x="${bar.x1 - 4}" y="${y(38)}" width="4" height="${y(30) - y(38)}"/>`;
    else svg += `<line class="st-line" x1="${bar.x1}" x2="${bar.x1}" y1="${y(38)}" y2="${y(30)}"/>`;

    // beam groups
    const groups = [];
    let open = null;
    for (const it of bar.items) {
      const b1 = it.n.beams['1'];
      if (it.n.rest || !FLAGS[it.n.type] || !b1) { open = null; continue; }
      if (b1 === 'begin' || !open) { open = [it]; groups.push(open); } else open.push(it);
      if (b1 === 'end') open = null;
    }
    const beamed = new Map();
    for (const g of groups.filter((g2) => g2.length > 1)) {
      const steps = g.flatMap((it) => it.n.pitches.map(stepOf));
      const up = steps.reduce((a, b) => a + b, 0) / steps.length < MIDDLE;
      const tipOf = (it) => {
        const ss = it.n.pitches.map(stepOf);
        return up ? y(Math.max(...ss)) - STEM : y(Math.min(...ss)) + STEM;
      };
      const xs = g.map((it) => it.x + (up ? 5.4 : -5.4));
      let y1 = tipOf(g[0]), y2 = tipOf(g[g.length - 1]);
      const dx = xs[xs.length - 1] - xs[0] || 1;
      const maxSlope = 0.12 * dx;
      if (Math.abs(y2 - y1) > maxSlope) y2 = y1 + Math.sign(y2 - y1) * maxSlope;
      // every stem at least a little long
      let shift = 0;
      g.forEach((it, k) => {
        const by = y1 + (y2 - y1) * (xs[k] - xs[0]) / dx;
        const t = tipOf(it);
        shift = up ? Math.min(shift, t - by) : Math.max(shift, t - by);
      });
      y1 += shift; y2 += shift;
      const at = (k) => y1 + (y2 - y1) * (xs[k] - xs[0]) / dx;
      g.forEach((it, k) => beamed.set(it, { up, tip: at(k) }));
      const T = 4.6, dir = up ? 1 : -1;
      const keyOf = (it) => order(bar.b, it.i);
      const col = g.every((it) => keyOf(it) < curKey) ? 'done' : '';
      let beams = `<path class="sc-beam ${col}" d="M${xs[0]} ${y1} L${xs[xs.length - 1]} ${y2} L${xs[xs.length - 1]} ${y2 + T * dir} L${xs[0]} ${y1 + T * dir} Z"/>`;
      for (let lvl = 2; lvl <= 4; lvl++) {
        const off = (lvl - 1) * 7.5 * dir;
        for (let k = 0; k < g.length; k++) {
          const bv = g[k].n.beams[String(lvl)];
          if (!bv) continue;
          let a = null, b = null;
          if ((bv === 'begin' || bv === 'continue') && g[k + 1]?.n.beams[String(lvl)]) { a = k; b = k + 1; }
          if (a !== null) {
            beams += `<path class="sc-beam ${col}" d="M${xs[a]} ${at(a) + off} L${xs[b]} ${at(b) + off} L${xs[b]} ${at(b) + off + T * dir} L${xs[a]} ${at(a) + off + T * dir} Z"/>`;
          } else if (bv.includes('hook')) {
            const x2 = xs[k] + (bv.startsWith('forward') ? 8 : -8);
            const yy = at(k) + off;
            beams += `<path class="sc-beam ${col}" d="M${xs[k]} ${yy} L${x2} ${yy} L${x2} ${yy + T * dir} L${xs[k]} ${yy + T * dir} Z"/>`;
          }
        }
      }
      svg += beams;
    }

    // notes and rests
    bar.items.forEach((it, idx) => {
      const { n } = it;
      const k = order(bar.b, it.i);
      // a tied continuation shares the state of the note it continues
      let stateKey = k;
      if (n.tieStop) {
        for (let j = idx - 1; j >= 0; j--) { const p = bar.items[j]; if (!p.n.tieStop && !p.n.rest) { stateKey = order(bar.b, p.i); break; } }
      }
      const cls = stateKey === curKey ? 'cur' : stateKey === nextKey ? 'next' : stateKey < curKey ? 'done' : '';
      if (cls === 'cur' && !n.tieStop) bands += `<rect class="sc-cur-band" x="${it.x - 13}" y="${y(40)}" width="26" height="${y(28) - y(40)}"/>`;
      svg += `<g class="sc-note ${cls}">${n.rest ? rest(n, it.x, y) : note(n, it, y, beamed.get(it))}</g>`;
      if (!single && !n.rest) hits += `<rect class="sc-hit" data-m="${bar.b}" data-n="${it.i}" x="${it.x - 10}" y="${y(range.top)}" width="20" height="${y(range.bottom) - y(range.top)}"/>`;
      if (n.tieStart && !n.rest) {
        const nxt = bar.items[idx + 1] || null;
        const nextBar = bars.find((b2) => b2.b === bar.b + 1);
        const target = nxt ? nxt.x : nextBar?.items[0] ? nextBar.items[0].x : bar.x1 + 10;
        const top = n.pitches[n.pitches.length - 1];
        const up = (beamed.get(it)?.up) ?? (avgStep(n) < MIDDLE);
        const yy = y(stepOf(top)) + (up ? 7 : -7);
        const x1 = it.x + 6, x2 = Math.min(target - 6, lineEnd);
        svg += `<path class="sc-tie ${cls}" d="M${x1} ${yy} Q${(x1 + x2) / 2} ${yy + (up ? 7 : -7)} ${x2} ${yy}"/>`;
      }
    });
  }

  let size = '';
  if (scale && box) {
    const k = Math.min(scale, box.w / W, box.h / H); // only ever smaller than the shared size, never bigger
    size = ` style="width:${Math.round(W * k)}px;height:${Math.round(H * k)}px"`;
  }
  if (single && first.ottava && bars[0]?.items[0]) {
    const it0 = bars[0].items[0];
    svg += `<text class="st-8va" x="${it0.x + 9}" y="${y(Math.max(...it0.n.pitches.map(stepOf))) - 6}">8va</text>`;
  }
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="stave-svg score-svg"${size} role="img" aria-label="Bars ${first.number}${count > 1 ? '–' + score.measures[start + count - 1].number : ''}">${bands}${svg}${hits}</svg>`;
}

function keyAlters(fifths) {
  const out = {};
  if (fifths > 0) KEY_LETTERS_SHARP.slice(0, fifths).forEach((l) => { out[l] = 1; });
  if (fifths < 0) KEY_LETTERS_FLAT.slice(0, -fifths).forEach((l) => { out[l] = -1; });
  return out;
}

function keySignature(fifths, x, y) {
  let s = '';
  const steps = fifths > 0 ? SHARP_STEPS : FLAT_STEPS;
  for (let i = 0; i < Math.abs(fifths); i++) s += `<text class="st-acc sc-key" x="${x + 4 + i * 8}" y="${y(steps[i])}" dy="0.33em">${fifths > 0 ? '♯' : '♭'}</text>`;
  return s;
}

function timeSignature(t, x, y) {
  if (t.symbol === 'common' && t.beats === 4 && t.beatType === 4) return `<text class="sc-time" x="${x}" y="${y(34)}" dy="0.35em">C</text>`;
  return `<text class="sc-time" x="${x}" y="${y(36)}" dy="0.35em">${t.beats}</text><text class="sc-time" x="${x}" y="${y(32)}" dy="0.35em">${t.beatType}</text>`;
}

const avgStep = (n) => n.pitches.reduce((a, p) => a + stepOf(p), 0) / n.pitches.length;

function note(n, it, y, beam) {
  const x = it.x;
  const steps = n.pitches.map(stepOf);
  const hi = Math.max(...steps), lo = Math.min(...steps);
  const up = beam ? beam.up : (hi + lo) / 2 < MIDDLE;
  const beats = BEATS[n.type] ?? 1;
  const hollow = beats >= 2;
  let s = '';
  // ledger lines
  for (let st = 28; st >= lo; st -= 2) s += `<line class="sc-ledger" x1="${x - 10}" x2="${x + 10}" y1="${y(st)}" y2="${y(st)}"/>`;
  for (let st = 40; st <= hi; st += 2) s += `<line class="sc-ledger" x1="${x - 10}" x2="${x + 10}" y1="${y(st)}" y2="${y(st)}"/>`;
  // heads (a second apart: nudge the upper one across)
  n.pitches.forEach((p, k) => {
    const st = steps[k];
    const clash = k > 0 && st - steps[k - 1] === 1;
    const hx = clash ? x + (up ? 11 : -11) : x;
    s += hollow
      ? `<ellipse class="sc-head hollow" cx="${hx}" cy="${y(st)}" rx="5.6" ry="4" transform="rotate(-20 ${hx} ${y(st)})"/>`
      : `<ellipse class="sc-head" cx="${hx}" cy="${y(st)}" rx="5.9" ry="4.2" transform="rotate(-20 ${hx} ${y(st)})"/>`;
    const a = it.acc[k];
    if (a !== null && a !== undefined) s += `<text class="sc-acc" x="${x - 13 - (k % 2) * 7}" y="${y(st)}" dy="0.33em">${ACC[a]}</text>`;
    for (let d = 0; d < n.dots; d++) {
      const dy = st % 2 === 0 ? 1 : 0; // on a line: dot in the space above
      s += `<circle class="sc-dot" cx="${x + 10 + d * 4.5}" cy="${y(st + dy)}" r="1.7"/>`;
    }
  });
  // stem and flags
  if (beats < 4) {
    const sx = x + (up ? 5.4 : -5.4);
    const from = up ? y(lo) : y(hi);
    const tip = beam ? beam.tip : (up ? y(hi) - STEM : y(lo) + STEM);
    s += `<line class="sc-stem" x1="${sx}" x2="${sx}" y1="${from}" y2="${tip}"/>`;
    const flags = FLAGS[n.type] || 0;
    if (!beam) for (let f = 0; f < flags; f++) {
      const fy = tip + (up ? f * 7 : -f * 7);
      s += up
        ? `<path class="sc-flag" d="M${sx} ${fy} c1 6 9 8 8 17 c-1 -6 -5 -9 -8 -10 z"/>`
        : `<path class="sc-flag" d="M${sx} ${fy} c1 -6 9 -8 8 -17 c-1 6 -5 9 -8 10 z"/>`;
    }
  }
  return s;
}

function rest(n, x, y) {
  const beats = n.wholeBarRest ? 4 : BEATS[n.type] ?? 1;
  const c = y(34);
  if (beats >= 4) return `<rect class="sc-rest" x="${x - 6}" y="${y(36)}" width="12" height="5"/>`;
  if (beats >= 2) return `<rect class="sc-rest" x="${x - 6}" y="${y(34) - 5}" width="12" height="5"/>`;
  if (beats >= 1) return `<path class="sc-rest" d="M${x - 2} ${c - 13} l6 7 l-5 6 l6 7 c-4 -2 -8 0 -5 5 c-6 -3 -5 -9 1 -8 l-5 -6 l5 -6 z"/>`;
  const flags = beats >= 0.5 ? 1 : beats >= 0.25 ? 2 : 3;
  let s = `<path class="sc-rest-stroke" d="M${x + 4} ${c - 6} L${x - 1} ${c + 8 + (flags - 1) * 6}"/>`;
  for (let f = 0; f < flags; f++) s += `<circle class="sc-rest" cx="${x - 2 + f * -1.5}" cy="${c - 5 + f * 6}" r="2.4"/><path class="sc-rest-stroke" d="M${x - 2 - f * 1.5} ${c - 4 + f * 6} Q${x + 1} ${c - 2 + f * 6} ${x + 4 - f * 1.2} ${c - 6 + f * 6}"/>`;
  return s;
}
