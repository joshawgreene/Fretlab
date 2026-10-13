// Play mode. Run: node tests/play.test.mjs
// 1. Reading MusicXML: the sample, a plain-treble melody, a zipped .mxl, key/time changes, ties, chords, rests.
// 2. Fingering: every note on a real string/fret, the hand kept in one area.
// 3. Following a piece at tempo with repeated notes (each repeat needs its own pick, and gets counted once).
import { readFile } from 'node:fs/promises';
import { readScore, playEvents, fileToXml, parseXml } from '../js/musicxml.js';
import { chooseFingering } from '../js/fingering.js';
import { analyseFrame, NOTE_FRAME, consumePluck } from '../js/analysis.js';
import { NoteTracker } from '../js/tracker.js';
import { midiToFreq } from '../js/notes.js';
import { SR, HOP, playTimed } from './guitar-synth.mjs';

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
const STD = [40, 45, 50, 55, 59, 64];

// ---------- 1. reading ----------
const sampleXml = await readFile(new URL('../samples/ode-to-joy.musicxml', import.meta.url), 'utf8');
const ode = readScore(sampleXml);
const odeEv = playEvents(ode);
check(ode.title === 'Ode to Joy' && ode.measures.length === 16, `sample: "${ode.title}", ${ode.measures.length} bars`);
check(ode.measures.every((m) => Math.abs(m.notes.reduce((a, n) => a + n.beats, 0) - m.beats) < 1e-9), 'every bar adds up to its time signature');
check(odeEv.length === 62 && odeEv[0].midi === 52 && Math.min(...odeEv.map((e) => e.midi)) === 43, 'sample sounds where guitar plays it (starts on E3, lowest G2)');

// The same tune written in a plain treble clef (how melodies are usually written) reads the same on guitar.
const plain = sampleXml.replace('<clef-octave-change>-1</clef-octave-change>', '').replace(/<octave>(\d)<\/octave>/g, (_, o) => `<octave>${+o + 1}</octave>`);
const plainEv = playEvents(readScore(plain));
check(plainEv.every((e, i) => e.midi === odeEv[i].midi), 'plain treble clef = guitar notation (sounds an octave below written)');

// A melody too high for guitar is brought down an octave.
const high = sampleXml.replace(/<octave>(\d)<\/octave>/g, (_, o) => `<octave>${+o + 3}</octave>`);
const highSc = readScore(high);
check(highSc.octaveShift === -12 && playEvents(highSc).every((e) => e.midi <= 86), 'out-of-range music is shifted into the guitar\'s range');

// Zipped .mxl: build one with a stored (uncompressed) entry and a deflated one.
async function makeZip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const deflated = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const nm = enc.encode(name);
    const head = new Uint8Array(30 + nm.length); const dv = new DataView(head.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(8, 8, true); dv.setUint32(18, deflated.length, true); dv.setUint32(22, raw.length, true);
    dv.setUint16(26, nm.length, true); head.set(nm, 30);
    const cen = new Uint8Array(46 + nm.length); const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, deflated.length, true); cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nm.length, true); cv.setUint32(42, offset, true); cen.set(nm, 46);
    parts.push(head, deflated); central.push(cen); offset += head.length + deflated.length;
  }
  const cenLen = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, cenLen, true); ev.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...parts, ...central, end]).arrayBuffer());
}
const mxl = await makeZip({ 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="music/score.xml"/></rootfiles></container>', 'music/score.xml': sampleXml });
const fromZip = await fileToXml(mxl);
check(fromZip === sampleXml, '.mxl (zipped MusicXML) unpacks to the score inside');

// Ties, chords, rests, key and time changes, a second part.
const n = (p, dur, type, extra = '') => { p = p && p.match(/^([A-G])(-?\d)(\d)$/); return `<note>${p ? `<pitch><step>${p[1]}</step>${p[2] !== '0' ? `<alter>${p[2]}</alter>` : ''}<octave>${p[3]}</octave></pitch>` : '<rest/>'}<duration>${dur}</duration>${extra}<voice>1</voice><type>${type}</type></note>`; };
const tricky = `<?xml version="1.0"?><!DOCTYPE score-partwise><score-partwise><part-list><score-part id="A"><part-name>Lead &amp; melody</part-name></score-part><score-part id="B"><part-name>Bass</part-name></score-part></part-list>
<part id="A"><measure number="1"><attributes><divisions>2</divisions><key><fifths>-2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
${n('B-14', 2, 'quarter')}${n('', 2, 'quarter')}${n('D05', 2, 'quarter', '<tie type="start"/>')}</measure>
<measure number="2">${n('D05', 2, 'quarter', '<tie type="stop"/>')}<note><chord/><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>${n('E-14', 4, 'half')}</measure>
<measure number="3"><attributes><key><fifths>1</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time></attributes><!-- comment -->${n('F15', 4, 'half')}<backup><duration>4</duration></backup><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>half</type></note></measure></part>
<part id="B"><measure number="1"><attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>${n('A02', 3, 'half', '')}</measure></part></score-partwise>`;
const tr = readScore(tricky);
const trEv = playEvents(tr);
check(tr.parts.length === 2 && tr.parts[0].name === 'Lead & melody', 'parts listed (and entities decoded)');
check(tr.measures[2].keyChanged && tr.measures[2].timeChanged && tr.measures[2].key === 1 && tr.measures[0].key === -2, 'key and time changes');
check(trEv.map((e) => e.midi).join() === '58,62,65,51,66', `tied note counted once, chord → its top note (even over a tie), second voice ignored (${trEv.map((e) => e.midi)})`);
check(readScore(tricky, { part: 1 }).measures[0].notes[0].pitches[0].midi === 45, 'bass clef part reads at sounding pitch (A2)');
for (const [bad, why] of [['<html><body>hi</body></html>', 'not MusicXML'], ['<score-timewise></score-timewise>', 'timewise']]) {
  let msg = ''; try { readScore(bad); } catch (e) { msg = e.message; }
  check(msg.length > 0, `clear error for ${why}: “${msg.slice(0, 60)}…”`);
}
check(parseXml('<a x="1 > 2"><b>t</b><c/></a>').children[0].attrs.x === '1 > 2', 'XML: quoted ">" inside attributes');

// ---------- 2. fingering ----------
const fg = chooseFingering(odeEv, STD);
check(fg.every((p, i) => STD[p.s] + p.f === odeEv[i].midi && p.f >= 0 && p.f <= 22), 'every note fingered on a real string and fret');
check(Math.max(...fg.map((p) => p.f)) <= 3, `sample stays in open position (highest fret ${Math.max(...fg.map((p) => p.f))})`);
const run = [64, 66, 68, 69, 71, 73, 75, 76, 78, 80, 81, 83].map((midi) => ({ midi })); // E major, two octaves up
const fr = chooseFingering(run, STD);
const jumps = fr.slice(1).filter((p, i) => p.f && fr[i].f && Math.abs(p.f - fr[i].f) > 5).length;
check(jumps <= 1, `a run up the neck moves the hand smoothly (big jumps: ${jumps}) ${fr.map((p) => `${6 - p.s}:${p.f}`).join(' ')}`);
const tab = chooseFingering([{ midi: 59, string: 3, fret: 4 }, { midi: 59 }], STD);
check(tab[0].s === 3 && tab[0].f === 4, 'string/fret from the file (tab) is kept when it fits the tuning');

// ---------- 3. following at tempo, repeated notes ----------
function follow(events, bpm, opts) {
  const q = 60 / bpm;
  let at = 0;
  const notes = events.map((e) => { const x = { midi: e.midi, at, dur: e.beats * q }; at += e.beats * q; return x; });
  const sig = playTimed(notes, opts);
  const trk = new NoteTracker(); trk.gate = 0.04 * Math.pow(0.04, 0.55); trk.minFreq = midiToFreq(40) * 0.94;
  let idx = 0, heard = null, claim = null; const lat = []; let early = 0;
  for (let st = 0; st + NOTE_FRAME <= sig.length && idx < notes.length; st += HOP) {
    const t = (st + NOTE_FRAME) / SR;
    trk.expect = midiToFreq(notes[idx].midi);
    const f = analyseFrame(sig.subarray(st, st + NOTE_FRAME), SR, { notes: trk }, t * 1000);
    let adv = false;
    if (f.expect?.hit) { adv = true; consumePluck(trk); claim = notes[idx].midi; }
    else if (f.active && f.midi !== heard) { if (f.midi === claim) claim = null; else if (f.midi === notes[idx].midi) { adv = true; consumePluck(trk); } }
    heard = f.active ? f.midi : null; if (!f.active) claim = null;
    if (adv) { if (t < notes[idx].at) early++; else lat.push((t - notes[idx].at) * 1000); idx++; }
  }
  return { lat, early, missed: notes.length - idx, n: notes.length };
}
const repeats = [52, 52, 52, 52, 45, 45, 45, 45, 57, 57, 55, 55, 52, 52, 64, 64, 64, 64, 76, 76, 76, 76, 71, 71, 40, 40, 40, 40].map((midi) => ({ midi, beats: 0.25 }));
const lat = []; let early = 0, missed = 0, total = 0;
for (const bpm of [80, 120, 160]) for (const opts of [{ hpHz: 150 }, { hpHz: 300 }]) {
  for (const evs of [odeEv, bpm <= 120 ? repeats : repeats.map((e) => ({ ...e, beats: 0.5 }))]) {
    const r = follow(evs, bpm, opts); lat.push(...r.lat); early += r.early; missed += r.missed; total += r.n;
  }
}
lat.sort((a, b) => a - b);
const med = Math.round(lat[lat.length >> 1]), p90 = Math.round(lat[Math.floor(lat.length * 0.9)]);
check(early === 0, `no note ticked off before it was played — repeated notes never count twice (${early})`);
check(missed === 0, `every note counted, repeated notes included (${missed} missed of ${total})`);
check(med <= 40, `each note ticks off in ${med} ms typical (p90 ${p90} ms)`);

// One note held (no new pick) while the music asks for the same note twice: counts once, not twice.
for (const opts of [{ hpHz: 150 }, { hpHz: 300 }, { hpHz: 150, vibrato: 25 }, { hpHz: 300, vibrato: 25 }]) for (const midi of [40, 52, 64, 76]) {
  const sig = playTimed([{ midi, at: 0, dur: 2.5 }], opts);
  const trk = new NoteTracker(); trk.gate = 0.04 * Math.pow(0.04, 0.55); trk.minFreq = midiToFreq(40) * 0.94;
  let count = 0, heard = null, claim = null;
  for (let st = 0; st + NOTE_FRAME <= sig.length; st += HOP) {
    trk.expect = midiToFreq(midi);
    const f = analyseFrame(sig.subarray(st, st + NOTE_FRAME), SR, { notes: trk }, (st + NOTE_FRAME) / SR * 1000);
    if (f.expect?.hit) { count++; consumePluck(trk); claim = midi; }
    else if (f.active && f.midi !== heard) { if (f.midi === claim) claim = null; else if (f.midi === midi) { count++; consumePluck(trk); } }
    heard = f.active ? f.midi : null; if (!f.active) claim = null;
  }
  check(count === 1, `${opts.hpHz === 150 ? 'laptop' : 'phone'}${opts.vibrato ? ', with vibrato' : ''}: one held ${['low E', 'E3', 'high E', 'E5'][[40, 52, 64, 76].indexOf(midi)]} counts once (${count})`);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
