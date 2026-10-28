// A chord progression drawn as one picture: a diagram per chord, in order, ready to save as a JPEG.
// Pure canvas drawing; the app hands it the chords and gets back a canvas.

const INK = '#111111';
const MUTED = '#77736b';
const ACCENT = '#7a2ff0';      // chords purple
const ROOT = '#4b12a8';
const BG = '#ffffff';
const DISPLAY = "'Archivo', 'Inter', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

/** Which fret rows a diagram shows: from the nut if it all fits in the first five frets, otherwise from the lowest fretted note. */
export function fretWindow(frets) {
  const fretted = frets.filter((f) => f > 0);
  if (!fretted.length) return { first: 1, rows: 5 };
  const lo = Math.min(...fretted), hi = Math.max(...fretted);
  if (hi <= 5) return { first: 1, rows: 5 };
  return { first: lo, rows: Math.max(5, hi - lo + 1) };
}

/** A barre: the lowest fret held on 3+ strings, with nothing lower (or muted) between its ends. */
export function findBarre(frets) {
  const fretted = frets.filter((f) => f > 0);
  if (!fretted.length) return null;
  const lo = Math.min(...fretted);
  const at = frets.map((f, s) => (f === lo ? s : -1)).filter((s) => s >= 0);
  if (at.length < 3) return null;
  const from = at[0], to = at[at.length - 1];
  for (let s = from; s <= to; s++) if (frets[s] < lo) return null;
  return { fret: lo, from, to };
}

/**
 * Draw the sheet.
 * @param {{name:string, frets:number[], numeral?:string, rootPc?:number|null}[]} chords  low string first in frets
 * @param {{tuning:number[], title?:string, subtitle?:string, scale?:number}} opts  tuning as MIDI notes, low string first
 * @returns {HTMLCanvasElement}
 */
export function drawChordSheet(chords, { tuning, title = 'Chord progression', subtitle = '', scale = 2 } = {}) {
  const strings = tuning.length;
  const perRow = Math.min(4, Math.max(1, chords.length));
  const rowsOfChords = Math.ceil(chords.length / perRow);
  const maxFretRows = Math.max(5, ...chords.map((c) => fretWindow(c.frets).rows));

  // one cell: name, x/o row, the grid, numeral underneath
  const gap = 22;                       // between strings
  const fretH = 28;
  const gridW = gap * (strings - 1);
  const cellW = Math.max(190, gridW + 90);
  const cellH = 64 + 22 + fretH * maxFretRows + 46;
  const margin = 36, headH = subtitle ? 78 : 60, footH = 34;
  const W = margin * 2 + cellW * perRow;
  const H = headH + cellH * rowsOfChords + footH;

  const cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = BG; g.fillRect(0, 0, W, H);

  // header
  g.fillStyle = INK; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  let ts = 26;
  g.font = `900 ${ts}px ${DISPLAY}`;
  while (g.measureText(title).width > W - 2 * margin && ts > 18) { ts -= 1; g.font = `900 ${ts}px ${DISPLAY}`; }
  if (g.measureText(title).width > W - 2 * margin) { title = 'Chord progression'; g.font = `900 26px ${DISPLAY}`; } // the names are on the diagrams anyway
  g.fillText(title, margin, 44);
  if (subtitle) { g.fillStyle = MUTED; g.font = `700 13px ${MONO}`; g.fillText(subtitle.toUpperCase(), margin, 66); }
  g.fillStyle = INK; g.fillRect(margin, headH - 8, W - 2 * margin, 3);

  chords.forEach((c, i) => {
    const col = i % perRow, row = Math.floor(i / perRow);
    const x0 = margin + col * cellW, y0 = headH + row * cellH;
    drawDiagram(g, c, { x: x0 + (cellW - gridW) / 2, y: y0, cellW, x0, tuning, gap, fretH, rows: maxFretRows, index: i + 1 });
  });

  // footer
  g.fillStyle = MUTED; g.font = `700 11px ${MONO}`; g.textAlign = 'right';
  g.fillText('FRETLAB', W - margin, H - 14);
  return cv;
}

function drawDiagram(g, c, { x, y, cellW, x0, tuning, gap, fretH, rows, index }) {
  const strings = tuning.length;
  const { first } = fretWindow(c.frets);
  const gridW = gap * (strings - 1);
  const top = y + 64 + 22;              // top of the grid

  // number + name
  g.textAlign = 'center';
  g.fillStyle = MUTED; g.font = `700 11px ${MONO}`;
  g.fillText(String(index), x0 + cellW / 2, y + 22);
  g.fillStyle = INK;
  let size = 30;
  g.font = `900 ${size}px ${DISPLAY}`;
  while (g.measureText(c.name).width > cellW - 24 && size > 14) { size -= 2; g.font = `900 ${size}px ${DISPLAY}`; }
  g.fillText(c.name, x0 + cellW / 2, y + 56);

  // open / muted marks above the nut
  g.lineWidth = 2; g.strokeStyle = INK;
  c.frets.forEach((f, s) => {
    const sx = x + s * gap, my = top - 13;
    if (f < 0) {
      g.beginPath(); g.moveTo(sx - 5, my - 5); g.lineTo(sx + 5, my + 5); g.moveTo(sx + 5, my - 5); g.lineTo(sx - 5, my + 5); g.stroke();
    } else if (f === 0) {
      g.beginPath(); g.arc(sx, my, 5.5, 0, Math.PI * 2); g.stroke();
    }
  });

  // grid: nut (thick) or the starting fret's number
  g.fillStyle = INK;
  if (first === 1) g.fillRect(x - 1, top - 5, gridW + 2, 6);
  else {
    g.font = `700 13px ${MONO}`; g.textAlign = 'right';
    g.fillText(`${first}fr`, x - 10, top + fretH / 2 + 5);
  }
  g.lineWidth = 1.5;
  for (let r = 0; r <= rows; r++) { g.beginPath(); g.moveTo(x, top + r * fretH); g.lineTo(x + gridW, top + r * fretH); g.stroke(); }
  for (let s = 0; s < strings; s++) { g.beginPath(); g.moveTo(x + s * gap, top); g.lineTo(x + s * gap, top + rows * fretH); g.stroke(); }

  // barre, then the held notes (square, like the fretboard; roots darker)
  const isRoot = (s, f) => c.rootPc != null && (((tuning[s] + f) % 12) + 12) % 12 === c.rootPc;
  const dot = 16;
  const barre = findBarre(c.frets);
  if (barre) {
    const r = barre.fret - first;
    g.fillStyle = ACCENT;
    g.fillRect(x + barre.from * gap - dot / 2, top + r * fretH + (fretH - dot) / 2, (barre.to - barre.from) * gap + dot, dot);
  }
  c.frets.forEach((f, s) => {
    if (f <= 0) return;
    const r = f - first;
    const cx = x + s * gap, cy = top + r * fretH + fretH / 2;
    g.fillStyle = isRoot(s, f) ? ROOT : ACCENT;
    g.fillRect(cx - dot / 2, cy - dot / 2, dot, dot);
  });

  // fret numbers under the strings, and the numeral
  const below = top + rows * fretH;
  g.textAlign = 'center'; g.fillStyle = MUTED; g.font = `600 10px ${MONO}`;
  c.frets.forEach((f, s) => g.fillText(f < 0 ? 'x' : String(f), x + s * gap, below + 15));
  if (c.numeral) { g.fillStyle = ACCENT; g.font = `800 15px ${DISPLAY}`; g.fillText(c.numeral, x0 + cellW / 2, below + 37); }
}

/** Save (or, on phones, share) the canvas as a JPEG. */
export async function saveJpeg(canvas, filename) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  if (!blob) throw new Error('Could not make the image');
  const file = new File([blob], filename, { type: 'image/jpeg' });
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}
