// MusicXML reader for Play mode: .musicxml / .xml (plain) and .mxl (zipped). No dependencies, so the
// same code runs in the browser and in the Node tests.
//
// readScore() returns one part as a list of bars, each with its key, time signature and the notes of
// its main voice (the top voice of the top staff). Everything is converted to guitar terms: `midi` is
// the sounding pitch on guitar; `written` is the stave position in guitar notation (treble clef with an
// 8 below, i.e. an octave above sounding), keeping the file's own spelling.

const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const LETTER_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const TYPE_BEATS = { maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625 };

// ---------- a small XML parser (enough for MusicXML) ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m);

/** Parse XML text into { name, attrs, children, text }. Throws on badly broken markup. */
export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    const chunk = text.slice(i, lt === -1 ? n : lt);
    if (chunk.trim()) stack[stack.length - 1].text += decode(chunk);
    if (lt === -1) break;
    if (text.startsWith('<!--', lt)) { i = text.indexOf('-->', lt) + 3; if (i < 3) break; continue; }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt);
      stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3; continue;
    }
    if (text[lt + 1] === '?') { i = text.indexOf('?>', lt) + 2; continue; }
    if (text[lt + 1] === '!') { // DOCTYPE, possibly with an internal subset in [...]
      let j = lt + 2, depth = 0;
      for (; j < n; j++) { if (text[j] === '[') depth++; else if (text[j] === ']') depth--; else if (text[j] === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    // find the end of the tag, skipping quoted attribute values
    let j = lt + 1, q = null;
    for (; j < n; j++) { const c = text[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; }
    const raw = text.slice(lt + 1, j);
    i = j + 1;
    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      while (stack.length > 1) { const top = stack.pop(); if (top.name === name) break; }
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const m = body.match(/^\s*([^\s/>]+)/);
    if (!m) throw new Error('Bad XML');
    const el = { name: m[1], attrs: {}, children: [], text: '' };
    body.slice(m[0].length).replace(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, k, __, a, b) => { el.attrs[k] = decode(a ?? b); return ''; });
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}
const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el, name) => el?.children.find((c) => c.name === name) || null;
const txt = (el, name) => { const k = kid(el, name); return k ? k.text.trim() : null; };
const num = (el, name, d = null) => { const t = txt(el, name); return t === null || t === '' || isNaN(+t) ? d : +t; };

// ---------- .mxl (zip) ----------
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Read the files out of a zip archive: { name: Uint8Array }. Stored and deflated entries only. */
export async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let p = u8.length - 22; p >= Math.max(0, u8.length - 65557); p--) if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + csize);
    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = await inflateRaw(data);
  }
  return out;
}

/** Bytes of a .musicxml/.xml/.mxl file → MusicXML text. */
export async function fileToXml(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x50 && u8[1] === 0x4b) { // "PK": zipped (.mxl)
    const files = await unzip(u8);
    const dec = new TextDecoder();
    let path = null;
    if (files['META-INF/container.xml']) {
      const rf = findFirst(parseXml(dec.decode(files['META-INF/container.xml'])), 'rootfile');
      path = rf?.attrs['full-path'];
    }
    if (!path || !files[path]) path = Object.keys(files).find((f) => !f.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(f));
    if (!path) throw new Error('No MusicXML score inside this .mxl file.');
    return decodeText(files[path]);
  }
  return decodeText(u8);
}
function decodeText(u8) {
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  return new TextDecoder().decode(u8);
}
function findFirst(el, name) {
  for (const c of el.children) { if (c.name === name) return c; const f = findFirst(c, name); if (f) return f; }
  return null;
}

// ---------- the score ----------
export class ScoreError extends Error {}

/**
 * @param {string} xmlText
 * @param {{part?:number, tuning?:number[], frets?:number}} opts
 */
export function readScore(xmlText, { part = 0, tuning = [40, 45, 50, 55, 59, 64], frets = 22 } = {}) {
  let doc;
  try { doc = parseXml(xmlText); } catch { throw new ScoreError('That file couldn’t be read as MusicXML.'); }
  const root = doc.children.find((c) => c.name.startsWith('score-'));
  if (!root) throw new ScoreError('That file isn’t MusicXML. Export it from your notation app as MusicXML (.musicxml or .mxl).');
  if (root.name === 'score-timewise') throw new ScoreError('This is “timewise” MusicXML, which Fretlab can’t read yet. Re-export it as normal (partwise) MusicXML.');
  if (root.name !== 'score-partwise') throw new ScoreError('That file isn’t a MusicXML score.');

  const partList = kids(kid(root, 'part-list'), 'score-part').map((sp) => ({ id: sp.attrs.id, name: txt(sp, 'part-name') || sp.attrs.id }));
  const partEls = kids(root, 'part');
  if (!partEls.length) throw new ScoreError('This score has no parts.');
  const parts = partEls.map((p, i) => ({ id: p.attrs.id, name: partList.find((x) => x.id === p.attrs.id)?.name || `Part ${i + 1}` }));
  const partIndex = Math.min(Math.max(0, part), partEls.length - 1);
  const title = txt(kid(root, 'work'), 'work-title') || txt(root, 'movement-title')
    || kids(root, 'credit').map((c) => txt(c, 'credit-words')).find(Boolean) || 'Untitled';
  const composer = kids(kid(root, 'identification'), 'creator').find((c) => c.attrs.type === 'composer')?.text.trim() || '';

  const measures = readPart(partEls[partIndex]);
  partEls.forEach((pe, pi) => {
    if (pi === partIndex) return;
    kids(pe, 'measure').forEach((mEl, mi) => {
      const m = measures[mi];
      if (!m) return;
      for (const d of kids(mEl, 'direction')) for (const mark of structureMarks(d)) if (!m.marks.some((x) => x.text === mark.text)) m.marks.push(mark);
    });
  });
  if (!measures.some((m) => m.notes.some((n) => !n.rest))) throw new ScoreError('This part has no notes to play. If the score has several parts, try another.');

  // Octave: shift the whole piece by octaves if that fits the guitar's range better.
  const lo = Math.min(...tuning), hi = Math.max(...tuning) + frets;
  const all = measures.flatMap((m) => m.notes.flatMap((n) => n.pitches.map((p) => p.midi)));
  const fit = (s) => all.filter((x) => x + s < lo || x + s > hi).length;
  let shift = 0;
  for (const s of [12, -12, 24, -24]) if (fit(s) < fit(shift)) shift = s;
  if (shift) for (const m of measures) for (const n of m.notes) for (const p of n.pitches) { p.midi += shift; p.octave += shift / 12; }
  for (const m of measures) for (const n of m.notes) for (const p of n.pitches) p.playable = p.midi >= lo && p.midi <= hi;

  // the sections, for jumping around: every bar with a rehearsal mark or section name
  const sections = measures.map((m, i) => ({ bar: i, number: m.number, label: m.marks.filter((x) => x.type !== 'segno').map((x) => x.text).join(' · ') })).filter((x) => x.label);
  return { title, composer, parts, partIndex, measures, octaveShift: shift, sections };
}

function readPart(partEl) {
  const measures = [];
  let divisions = 1, key = 0, time = { beats: 4, beatType: 4 }, clefOctave = null, transpose = 0;
  let mainVoice = null;
  for (const mEl of kids(partEl, 'measure')) {
    const m = { number: mEl.attrs.number || String(measures.length + 1), notes: [], keyChanged: measures.length === 0, timeChanged: measures.length === 0,
      marks: [], repeatStart: false, repeatEnd: 0, ending: null, endingStop: false, barStyle: null };
    let cursor = 0, lastStart = 0, maxCursor = 0;
    for (const el of mEl.children) {
      if (el.name === 'attributes') {
        divisions = num(el, 'divisions', divisions);
        const k = kid(el, 'key');
        if (k && (!k.attrs.number || k.attrs.number === '1')) { const f = num(k, 'fifths', key); if (f !== key || !measures.length) m.keyChanged = true; key = f; }
        const t = kid(el, 'time');
        if (t) {
          const nt = { beats: parseInt(txt(t, 'beats')) || 4, beatType: num(t, 'beat-type', 4), symbol: t.attrs.symbol };
          if (nt.beats !== time.beats || nt.beatType !== time.beatType || !measures.length) m.timeChanged = true;
          time = nt;
        }
        const clef = kids(el, 'clef').find((c) => !c.attrs.number || c.attrs.number === '1');
        if (clef) {
          const sign = txt(clef, 'sign');
          const oc = num(clef, 'clef-octave-change', 0);
          // Pitches are encoded at the clef's sounding octave. A plain treble clef is read as guitar music
          // (sounds an octave lower than written); a treble-8 or bass clef is already at sounding pitch.
          clefOctave = sign === 'G' && oc === 0 ? -12 : 0;
        }
        const tr = kid(el, 'transpose');
        if (tr) transpose = num(tr, 'chromatic', 0) + 12 * num(tr, 'octave-change', 0);
      } else if (el.name === 'barline') {
        // repeats, 1st/2nd endings, double bars
        const loc = el.attrs.location || 'right';
        const rp = kid(el, 'repeat');
        if (rp?.attrs.direction === 'forward') m.repeatStart = true;
        if (rp?.attrs.direction === 'backward') m.repeatEnd = Number(rp.attrs.times) || 2;
        const en = kid(el, 'ending');
        if (en) {
          if (en.attrs.type === 'start') m.ending = (en.attrs.number || '1').replace(/\s+/g, '');
          else m.endingStop = en.attrs.type || 'stop'; // 'stop' has a closing hook, 'discontinue' doesn't
        }
        const style = txt(el, 'bar-style');
        if (style && loc === 'right') m.barStyle = style;
      } else if (el.name === 'direction') {
        for (const mark of structureMarks(el)) if (!m.marks.some((x) => x.text === mark.text)) m.marks.push(mark);
      } else if (el.name === 'backup') { cursor -= num(el, 'duration', 0); }
      else if (el.name === 'forward') { cursor += num(el, 'duration', 0); maxCursor = Math.max(maxCursor, cursor); }
      else if (el.name === 'note') {
        const isChord = !!kid(el, 'chord');
        const grace = !!kid(el, 'grace');
        const dur = grace ? 0 : num(el, 'duration', 0);
        const start = isChord ? lastStart : cursor;
        if (!isChord) { lastStart = cursor; cursor += dur; maxCursor = Math.max(maxCursor, cursor); }
        const staff = num(el, 'staff', 1);
        const voice = txt(el, 'voice') || '1';
        if (staff !== 1 || grace || kid(el, 'cue')) continue;
        if (mainVoice === null && !kid(el, 'rest')) mainVoice = voice;
        if (voice !== (mainVoice ?? voice)) continue;
        const tieTypes = [...kids(el, 'tie'), ...kids(kid(el, 'notations'), 'tied')].map((t) => t.attrs.type);
        if (isChord) {
          const prev = m.notes[m.notes.length - 1];
          const p = pitchOf(el, clefOctave, transpose);
          if (prev && !prev.rest && p) prev.pitches.push({ ...p, tieStart: tieTypes.includes('start'), tieStop: tieTypes.includes('stop') });
          continue;
        }
        const type = txt(el, 'type');
        const dots = kids(el, 'dot').length;
        const beats = dur / divisions * (4 / 4); // in quarter notes
        const beams = {};
        for (const b of kids(el, 'beam')) beams[b.attrs.number || '1'] = b.text.trim();
        const tech = kid(kid(el, 'notations'), 'technical');
        const rest = !!kid(el, 'rest');
        const p = rest ? null : pitchOf(el, clefOctave, transpose);
        m.notes.push({
          start: start / divisions, beats, type: type || typeFromBeats(beats, dots), dots, rest: rest || !p,
          wholeBarRest: rest && (kid(el, 'rest').attrs.measure === 'yes' || !type),
          pitches: p ? [{ ...p, tieStart: tieTypes.includes('start'), tieStop: tieTypes.includes('stop') }] : [],
          tieStart: tieTypes.includes('start'), tieStop: tieTypes.includes('stop'),
          beams, string: num(tech, 'string'), fret: num(tech, 'fret'),
          stemDir: txt(el, 'stem'),
        });
      }
    }
    m.key = key; m.time = { ...time };
    m.beats = time.beats * 4 / time.beatType; m.length = Math.max(maxCursor / divisions, 0);
    for (const n of m.notes) n.pitches.sort((a, b) => a.midi - b.midi);
    measures.push(m);
  }
  return measures;
}

// Section names worth showing (expression words like "dolce" or "rit." are left out)
const SECTION_WORDS = /^\s*(intro|verse|chorus|pre-?\s?chorus|bridge|outro|solo|interlude|instrumental|coda|tag|refrain|break(down)?|ending|fine|d\.?\s?c\.?|d\.?\s?s\.?|da capo|dal segno|to coda|al coda|al fine|section|part|theme|middle\s?8|hook|riff|[A-H]['′]?\d?)\b/i;
/** Rehearsal marks, section names, segno and coda in a <direction>. */
function structureMarks(dirEl) {
  const out = [];
  for (const dt of kids(dirEl, 'direction-type')) {
    for (const r of kids(dt, 'rehearsal')) if (r.text.trim()) out.push({ type: 'rehearsal', text: r.text.trim() });
    for (const w of kids(dt, 'words')) { const t = w.text.trim(); if (t && t.length <= 24 && SECTION_WORDS.test(t)) out.push({ type: 'words', text: t }); }
    if (kid(dt, 'segno')) out.push({ type: 'segno', text: 'Segno' });
    if (kid(dt, 'coda')) out.push({ type: 'coda', text: 'Coda' });
  }
  return out;
}

function pitchOf(noteEl, clefOctave, transpose) {
  const pe = kid(noteEl, 'pitch');
  if (!pe) return null;
  const step = txt(pe, 'step');
  const letter = LETTER_INDEX[step];
  if (letter === undefined) return null;
  const alter = Math.round(num(pe, 'alter', 0));
  const octave = num(pe, 'octave', 4);
  const encoded = (octave + 1) * 12 + NATURAL_PC[letter] + alter;
  // transposing parts: <pitch> is written, <transpose> takes it to sounding; plain treble = guitar notation
  const sounding = encoded + transpose + (transpose ? 0 : (clefOctave ?? -12));
  return { letter, alter, midi: sounding, octave: Math.floor((sounding + 12 - alter - NATURAL_PC[letter]) / 12) - 1 };
}

function typeFromBeats(beats, dots) {
  const base = beats / (dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1);
  let best = 'quarter', err = Infinity;
  for (const [t, b] of Object.entries(TYPE_BEATS)) if (Math.abs(b - base) < err) { err = Math.abs(b - base); best = t; }
  return best;
}

/**
 * The notes to play, in order: one per note (chords → the top note, which is what the detector follows),
 * tied continuations and rests skipped.
 */
export function playEvents(score) {
  const out = [];
  score.measures.forEach((m, mi) => m.notes.forEach((n, ni) => {
    if (n.rest) return;
    const top = n.pitches[n.pitches.length - 1];
    if (top.tieStop || !top.playable) return; // a tied-over note is still ringing: nothing new to play
    out.push({ m: mi, n: ni, midi: top.midi, letter: top.letter, alter: top.alter, string: n.pitches.length === 1 ? n.string : null, fret: n.pitches.length === 1 ? n.fret : null, beats: n.beats });
  }));
  return out;
}
