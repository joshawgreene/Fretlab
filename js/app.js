import { TUNINGS, parseNote, midiToFreq, noteName, octaveOf, enharmonic, customNoteRange } from './notes.js';
import { PitchListener } from './audio.js';
import { Fretboard } from './fretboard.js';
import { renderStave } from './stave.js';
import { Tuner } from './tuner.js';
import { Metronome } from './metronome.js';
import { SCALES, ROOTS, scaleById, scalePcs, chordPcs, scaleSpelling, keyPref, rootName, positions, buildPath } from './scales.js';
import { consumePluck } from './analysis.js';
import { readScore, playEvents, fileToXml, ScoreError } from './musicxml.js';
import { renderScore, barWindow } from './score-stave.js';
import { chooseFingering } from './fingering.js';
import { CHORD_TYPES, CHORD_ROOTS, chordType, chordName, chordSpelling, chordShapes, distinctShapes, identifyChord, detectKey, numeral, suggestNext, easiestChange } from './chords.js';
import { spell } from './notes.js';

const $ = (s) => document.querySelector(s);
const STORE_KEY = 'fretlab:v1';

// ---------- state (persisted per browser) ----------
const defaults = {
  view: 'fretboard',
  tuningId: 'standard',
  custom: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'].map(parseNote),
  sensitivity: 0.55,
  bpm: 80,
  learnRoot: 0,
  learnScale: 'major',
  learnPosition: 'pos-1',
  learnAuto: false,     // after each run, move on to the next position
  learnArpeggio: false, // play just the scale's triad (root, 3rd, 5th) within the position
  playWide: false,      // Play: stave across the full width, four bars at a time
  playPart: 0,
  playIndex: 0,
  playStart: 0,         // Play: the note you chose to start from (↺ goes back here, then to the beginning)
  chordRoot: 0,
  chordType: 'maj',
  chordShape: 0,
  chordDraw: false,
  chordDrawn: [-1, -1, -1, -1, -1, -1], // Draw: fret per string, −1 = not played
  chordProg: [],        // Draw: the chords before the current one [{ rootPc, typeId, name, frets }]
  chordDone: false,     // Draw: the current chord is finished (Done) — only then show where to go next
};
const PIECE_KEY = 'fretlab:piece'; // the imported MusicXML, kept separately (it can be large)
const FRETS = 22;
const state = { ...defaults, ...load() };
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable: fine */ }
}

const currentTuning = () => {
  if (state.tuningId === 'custom') return { notes: state.custom, pref: 'sharp' };
  const t = TUNINGS.find((x) => x.id === state.tuningId) || TUNINGS[0];
  return { notes: t.notes.map(parseNote), pref: t.pref || 'sharp' };
};
// Sharps or flats: follow the scale's key in Learn mode, otherwise the tuning.
const notePref = () => (state.view === 'learn' ? keyPref(state.learnRoot, state.learnScale)
  : state.view === 'play' && play.score ? (play.score.measures[0].key < 0 ? 'flat' : 'sharp')
  : state.view === 'chords' ? chordPref() : currentTuning().pref);

const staveCompact = () => window.innerHeight < 760;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { lastReadoutKey = ''; showReadout(lastMidi, lastFrame, !lastFrame?.active); renderLearn(); renderPlay(); renderChord(); }, 120);
});

// ---------- components ----------
const listener = new PitchListener(onFrame);
const fretboard = new Fretboard($('#fretboard'), { onTap: tapNote });
const tuner = new Tuner($('#view-tuner'), { onPluck: (m) => listener.pluck(m) });

// ---------- controls ----------
const tuningSelect = $('#tuning-select');
tuningSelect.innerHTML = TUNINGS.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')
  + '<option value="custom">Custom…</option>';

function applyAll() {
  const { notes } = currentTuning();
  const pref = notePref();
  listener.setSensitivity(state.sensitivity);
  listener.tracker.minFreq = midiToFreq(Math.min(...notes)) * 0.94; // nothing below the lowest open string
  tuningSelect.value = state.tuningId;
  $('#sens-input').value = state.sensitivity;
  $('#sens-input').style.setProperty('--pct', `${state.sensitivity * 100}%`);
  fretboard.configure({ tuning: notes, frets: FRETS, pref, label: state.view === 'learn' ? learnLabel : state.view === 'chords' ? chordLabel : null });
  tuner.setTuning(notes, pref);
  renderCustomEditor();
  rebuildLearn();
  rebuildPlay();
  rebuildChord();
  lastReadoutKey = '';
  showReadout(lastMidi, lastFrame, !listener.running || !lastFrame?.active);
  save();
}

function renderCustomEditor() {
  const editor = $('#custom-editor');
  editor.hidden = state.tuningId !== 'custom';
  if (editor.hidden) return;
  const opts = customNoteRange(notePref());
  $('#custom-strings').innerHTML = state.custom.map((midi, i) => `
    <label class="custom-string"><span>${6 - i}</span>
      <select data-i="${i}">${opts.map((o) => `<option value="${o.midi}"${o.midi === midi ? ' selected' : ''}>${o.label}</option>`).join('')}</select>
    </label>`).join('');
}

$('#custom-strings').addEventListener('change', (e) => {
  const i = Number(e.target.dataset.i);
  state.custom[i] = Number(e.target.value);
  listener.pluck(state.custom[i]);
  applyAll();
});
tuningSelect.addEventListener('change', () => {
  state.tuningId = tuningSelect.value;
  fretboard.clearTrail();
  applyAll();
  if (state.tuningId === 'custom') $('#custom-editor').open = true;
});
$('#sens-input').addEventListener('input', (e) => { state.sensitivity = Number(e.target.value); e.target.style.setProperty('--pct', `${state.sensitivity * 100}%`); listener.setSensitivity(state.sensitivity); save(); });

// Tabs. Fretboard and Learn share the fretboard + stave; Learn swaps the note panel for its own.
function setView(view) {
  const changed = state.view !== view;
  if (changed) { closePanels(); stopLoop(); }
  state.view = view;
  document.body.dataset.view = view;
  listener.setTunerMode(view === 'tuner');
  if (view === 'tuner') tuner.update(null, listener.running);
  for (const v of ['fretboard', 'learn', 'play', 'chords', 'tuner']) $(`#tab-${v}`).setAttribute('aria-selected', String(v === view));
  $('#view-fretboard').hidden = view === 'tuner';
  $('#view-tuner').hidden = view !== 'tuner';
  if (changed) applyAll(); // note spelling and the fretboard overlay depend on the view
  save();
}
$('#tab-fretboard').addEventListener('click', () => setView('fretboard'));
$('#tab-learn').addEventListener('click', () => setView('learn'));
$('#tab-play').addEventListener('click', () => setView('play'));
$('#tab-chords').addEventListener('click', () => setView('chords'));
$('#tab-tuner').addEventListener('click', () => setView('tuner'));
$('#rotate-tuner').addEventListener('click', () => setView('tuner'));

// Mic
const micBtn = $('#mic-btn');
micBtn.addEventListener('click', async () => {
  hideBanner();
  if (listener.running) {
    listener.stop();
  } else {
    try {
      await listener.start();
    } catch (err) {
      showBanner(err.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.'
        : err.name === 'NotFoundError' ? 'No microphone found. Plug one in (or use your laptop’s built-in mic) and try again.'
        : err.message || 'Couldn’t start the microphone.');
    }
  }
  micBtn.setAttribute('aria-pressed', String(listener.running));
  $('#mic-label').textContent = listener.running ? 'Stop' : 'Listen';
  micBtn.setAttribute('aria-label', listener.running ? 'Stop listening' : 'Start listening');
  document.body.classList.toggle('listening', listener.running);
  if (listener.running) keepAwake(); else releaseWake();
});

// Drop-down panels (scale picker, piece menu, custom tuning): close on a tap elsewhere or Escape.
const closePanels = (except = null) => document.querySelectorAll('details[open]').forEach((d) => { if (d !== except) d.open = false; });
document.addEventListener('pointerdown', (e) => closePanels(e.target.closest('details')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanels(); });

// ---------- phones: keep the screen on while listening, recover after backgrounding ----------
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* not supported or refused (e.g. low battery): fine */ }
}
function releaseWake() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && listener.running) {
    listener.resume().catch(() => {}); // iOS suspends audio when the app is backgrounded or the screen locks
    keepAwake(); // the wake lock is dropped whenever the page is hidden
  }
});

function showBanner(msg) { const b = $('#banner'); b.textContent = msg; b.hidden = false; }
function hideBanner() { $('#banner').hidden = true; }

// ---------- live updates ----------
let lastMidi = null;
let lastFrame = null;


function onFrame(frame) {
  if (state.view === 'tuner') tuner.update(frame.tune, listener.running);
  if (frame.active) { lastMidi = frame.midi; lastFrame = frame; }
  if (state.view === 'learn') learnFrame(frame);
  else if (state.view === 'play') playFrame(frame);
  else if (state.view === 'chords') chordFrame(frame);
  else if (frame.active) fretboard.show(frame.midi);
  showReadout(lastMidi, frame.active ? frame : lastFrame, !frame.active);
}

/** Tap a fretboard position: hear it, and (when not listening) show it / play it in Learn mode. */
function tapNote(midi, s, f) {
  listener.pluck(midi);
  if (state.view === 'chords' && state.chordDraw && !chord.practice) { drawTap(s, f); return; }
  if (!listener.running) {
    lastMidi = midi;
    lastFrame = null;
    showReadout(midi, null, false);
    if (state.view === 'play') { playTap(midi, s, f); return; }
    if (state.view === 'chords') { chordTap(midi, s, f); return; }
    if (state.view !== 'learn') { fretboard.show(midi, { s, f }); return; }
    const t = learn.path[learn.index];
    if (learn.demo || !t) return;
    if (midi === t.midi) { fretboard.show(null); learnAdvance(); }
    else fretboard.show(midi, { s, f }); // a wrong tap is definite: mark it straight away
  }
}

// ---------- Learn mode ----------
// ---------- following along (shared by Learn and Play) ----------
// A wrong note only gets the blue marker once it has sounded this long, so the in-between
// readings you get when moving from note to note never flash up.
const WRONG_HOLD_MS = 140;
const makeFollower = () => ({ heard: null, claim: null, lastMatched: null, wrongMidi: null, wrongSince: 0 });

/**
 * Has the note we're waiting for (`want`) just been played? The analyser listens specifically for it
 * (frame.expect), which ticks it off a good 30 ms sooner than the general note reading; the general
 * reading still counts as a fallback, but never for a note the quick check already counted (it catches
 * up a moment later, and when the next note has the same pitch it would otherwise count twice).
 * Every tick-off disarms the quick check, so a repeated note needs its own pick.
 */
function followFrame(fw, frame, want) {
  let hit = false;
  if (frame.expect?.hit) { hit = true; fw.claim = want; }
  else if (frame.active && frame.midi !== fw.heard) {
    if (frame.midi === fw.claim) fw.claim = null;
    else if (frame.midi === want) hit = true;
  }
  fw.heard = frame.active ? frame.midi : null;
  if (!frame.active) fw.claim = null;
  if (hit) { consumePluck(listener.tracker); fw.lastMatched = want; fw.wrongMidi = null; }
  return hit;
}

/** The note to mark blue, if any: a definite wrong note — not the one we want, not the one just
 *  played (still ringing), and held long enough that it isn't a passing reading between two notes. */
function wrongNote(fw, frame, want) {
  const m = frame.active ? frame.midi : null;
  if (m === null || m === want || m === fw.lastMatched) { fw.wrongMidi = null; return null; }
  const now = performance.now();
  if (m !== fw.wrongMidi) { fw.wrongMidi = m; fw.wrongSince = now; }
  return now - fw.wrongSince >= WRONG_HOLD_MS ? m : null;
}

const learn = { path: [], index: 0, started: 0, demo: null, lastRun: 0, runs: 0, fw: makeFollower() };
const spelling = () => scaleSpelling(state.learnRoot, state.learnScale);
/** Fretboard labels in Learn mode: scale notes spelled for the key, anything else in the key's sharps/flats. */
function learnLabel(midi) {
  return spelling().get(((midi % 12) + 12) % 12)?.name ?? noteName(midi, keyPref(state.learnRoot, state.learnScale));
}

$('#learn-root').innerHTML = ROOTS.map((r) => `<option value="${r.pc}">${r.sharp === r.flat ? r.sharp : `${r.sharp} / ${r.flat}`}</option>`).join('');
$('#learn-scale').innerHTML = SCALES.map((sc) => `<option value="${sc.id}">${sc.name}</option>`).join('');
// A new key or scale starts again from Position 1.
$('#learn-root').addEventListener('change', (e) => { state.learnRoot = Number(e.target.value); state.learnPosition = 'pos-1'; applyAll(); });
$('#learn-scale').addEventListener('change', (e) => { state.learnScale = e.target.value; state.learnPosition = 'pos-1'; applyAll(); });
$('#learn-position').addEventListener('change', (e) => { state.learnPosition = e.target.value; applyAll(); });
$('#learn-auto').addEventListener('change', (e) => { state.learnAuto = e.target.checked; save(); renderLearn(); });
$('#learn-arp').addEventListener('change', (e) => { state.learnArpeggio = e.target.checked; applyAll(); });
$('#learn-restart').addEventListener('click', () => { restartLearn(); renderLearn(); });
$('#learn-hear').addEventListener('click', () => playDemo());

/** Recompute the scale path from the current settings, keeping progress if nothing changed. */
function rebuildLearn() {
  const { notes } = currentTuning();
  const frets = FRETS;
  const pos = positions(notes, state.learnRoot, state.learnScale, frets);
  if (!pos.some((p) => p.id === state.learnPosition)) state.learnPosition = pos[0]?.id ?? 'pos-1';
  $('#learn-position').innerHTML = pos.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  $('#learn-root').value = String(state.learnRoot);
  $('#learn-scale').value = state.learnScale;
  $('#learn-position').value = state.learnPosition;
  $('#learn-auto').checked = state.learnAuto;
  $('#learn-arp').checked = state.learnArpeggio;
  const path = buildPath(notes, { rootPc: state.learnRoot, scaleId: state.learnScale, positionId: state.learnPosition, frets,
    direction: 'updown', arpeggio: state.learnArpeggio });
  const sig = `${state.learnArpeggio}|` + path.map((n) => `${n.s}:${n.f}`).join();
  if (sig !== learn.sig) { learn.sig = sig; learn.path = path; restartLearn(learn.keepStats); }
  learn.keepStats = false;
  renderLearn();
}

function restartLearn(keepStats = false) {
  stopDemo();
  learn.index = 0;
  learn.started = 0;
  learn.fw.lastMatched = null;
  if (!keepStats) { learn.lastRun = 0; learn.runs = 0; }
}

/** One analysis frame in Learn mode. */
function learnFrame(frame) {
  const t = learn.path[learn.index];
  if (learn.demo || !t) return;
  if (followFrame(learn.fw, frame, t.midi)) learnAdvance();
  fretboard.show(wrongNote(learn.fw, frame, learn.path[learn.index]?.midi));
}

/** The note we were waiting for was played: flash it and move on. Runs repeat until you stop. */
function learnAdvance() {
  const t = learn.path[learn.index];
  const now = performance.now();
  fretboard.flash(t.s, t.f);
  fretboard.show(null);
  learn.fw.lastMatched = t.midi;
  learn.fw.wrongMidi = null;
  if (!learn.started) learn.started = now;
  learn.index++;
  if (learn.index >= learn.path.length) finishRun(now);
  renderLearn();
}

function finishRun(now) {
  learn.lastRun = now - learn.started;
  learn.runs++;
  const card = $('#learn-card');
  card.classList.remove('lap'); void card.offsetWidth; card.classList.add('lap');
  if (state.learnAuto) {
    const pos = positions(currentTuning().notes, state.learnRoot, state.learnScale, FRETS);
    const i = pos.findIndex((p) => p.id === state.learnPosition);
    state.learnPosition = pos[(i + 1) % pos.length]?.id ?? 'pos-1';
    save();
    learn.keepStats = true;
    const played = learn.fw.lastMatched;
    rebuildLearn();
    learn.fw.lastMatched = played;
    if (learn.index < learn.path.length) return; // new position: starts from its first note
  }
  // Go round again. The run ends on the note it starts with, so that note also begins the next run.
  learn.index = learn.path.length > 1 ? 1 : 0;
  learn.started = now;
}

function renderLearn() {
  const active = state.view === 'learn';
  const t = learn.path[learn.index];
  if (state.view !== 'play') listener.tracker.expect = active && t && !learn.demo ? midiToFreq(t.midi) : null;
  fretboard.setLearn(active ? {
    pcs: (state.learnArpeggio ? chordPcs : scalePcs)(state.learnRoot, state.learnScale), rootPc: state.learnRoot,
    path: learn.path, index: learn.index,
  } : null);
  if (!active) return;
  const pref = keyPref(state.learnRoot, state.learnScale);
  const name = scaleById(state.learnScale).name.toLowerCase();
  $('#learn-title').textContent = `${rootName(state.learnRoot, state.learnScale)} ${name}${state.learnArpeggio ? ' arpeggio' : ''}`;
  const total = learn.path.length;
  $('#learn-bar').style.transform = `scaleX(${total ? learn.index / total : 0})`;
  if (!t) {
    $('#learn-note').textContent = '—';
    $('#learn-where').textContent = 'No notes here — pick another position';
    $('#learn-count').textContent = '';
    return;
  }
  $('#learn-label').textContent = (learn.started ? 'Next' : 'Start') + (t.root ? ' · root' : '');
  const sp = spelling().get(((t.midi % 12) + 12) % 12);
  $('#learn-note').textContent = sp ? sp.name : noteName(t.midi, pref);
  $('#learn-oct').textContent = octaveOf(t.midi);
  $('#learn-where').textContent = `${t.f === 0 ? 'open' : `fret ${t.f}`} · string ${6 - t.s}`;
  const secs = Math.max(1, Math.round(learn.lastRun / 1000));
  const lastRun = learn.lastRun ? ` · last ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '';
  const posNum = state.learnAuto ? `Pos ${state.learnPosition.replace('pos-', '')} · ` : '';
  $('#learn-count').textContent = `${posNum}${learn.index + 1} of ${total}${lastRun}`;
  renderStave($('#stave'), t.midi, pref, { compact: staveCompact(), spelled: sp });
}

/** Play the scale through once, lighting each note. */
function playDemo() {
  if (learn.demo) { stopDemo(); renderLearn(); return; }
  restartLearn();
  let i = 0;
  const step = () => {
    if (i >= learn.path.length) { stopDemo(); renderLearn(); return; }
    const n = learn.path[i];
    listener.pluck(n.midi, 0.7);
    learn.index = i;
    renderLearn();
    fretboard.flash(n.s, n.f);
    i++;
    learn.demo = setTimeout(step, 360);
  };
  $('#learn-hear').setAttribute('aria-pressed', 'true');
  step();
}
function stopDemo() {
  if (learn.demo) clearTimeout(learn.demo);
  learn.demo = null;
  learn.index = 0;
  $('#learn-hear')?.setAttribute('aria-pressed', 'false');
}

// ---------- Play mode: play through an imported piece (MusicXML) ----------
const play = { xml: null, name: '', score: null, events: [], fingering: [], index: 0, started: 0, lastRun: 0, demo: null, help: false, fw: makeFollower(),
  browse: null }; // browse: first bar shown while looking around the piece (null = follow the note to play)
const ACC_TEXT = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Read (or re-read, e.g. after a tuning change) the piece. Returns false, with a message shown, if it can't. */
function loadPiece(xml, { name = play.name, keepIndex = false, store = true } = {}) {
  const { notes } = currentTuning();
  let score;
  try {
    score = readScore(xml, { part: state.playPart, tuning: notes, frets: FRETS });
  } catch (err) {
    showBanner(err instanceof ScoreError ? err.message : 'That file couldn’t be read. Is it a MusicXML file (.musicxml, .mxl or .xml)?');
    return false;
  }
  hideBanner();
  stopPlayDemo();
  play.xml = xml; play.name = name; play.score = score; play.help = false;
  play.tuningSig = String(notes);
  state.playPart = score.partIndex;
  play.events = playEvents(score);
  play.fingering = chooseFingering(play.events, notes, FRETS);
  play.index = keepIndex ? Math.min(state.playIndex, Math.max(0, play.events.length - 1)) : 0;
  if (!keepIndex) state.playStart = 0;
  state.playStart = Math.min(state.playStart, Math.max(0, play.events.length - 1));
  play.started = 0;
  if (!keepIndex) play.lastRun = 0;
  play.fw.lastMatched = null;
  play.browse = null;
  state.playIndex = play.index;
  if (store) { try { localStorage.setItem(PIECE_KEY, JSON.stringify({ xml, name })); } catch { /* too big to keep: fine */ } }
  $('#play-part').innerHTML = score.parts.map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join('');
  $('#play-part').value = String(score.partIndex);
  $('#play-part-field').hidden = score.parts.length < 2;
  save();
  if (state.view === 'play') applyAll(); else renderPlay(); // key spelling on the fretboard follows the piece
  return true;
}
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Tuning changed: string/fret choices (and maybe the octave) change with it. */
function rebuildPlay() {
  if (play.xml && play.tuningSig !== String(currentTuning().notes)) {
    play.tuningSig = String(currentTuning().notes);
    const { notes } = currentTuning();
    try {
      const score = readScore(play.xml, { part: state.playPart, tuning: notes, frets: FRETS });
      play.score = score;
      play.events = playEvents(score);
      play.fingering = chooseFingering(play.events, notes, FRETS);
      play.index = Math.min(play.index, Math.max(0, play.events.length - 1));
    } catch { /* it read before; leave it */ }
  }
  renderPlay();
}

async function importFile(file) {
  if (!file) return;
  try {
    const xml = await fileToXml(await file.arrayBuffer());
    if (loadPiece(xml, { name: file.name })) setView('play');
  } catch {
    showBanner('That file couldn’t be opened. Fretlab needs a MusicXML file (.musicxml, .mxl or .xml) — see “How to get a MusicXML file”.');
  }
}
async function loadSample() {
  try {
    const xml = await (await fetch('samples/ode-to-joy.musicxml')).text();
    state.playPart = 0;
    loadPiece(xml, { name: 'Ode to Joy (sample)' });
  } catch { showBanner('Couldn’t load the sample. Check your connection and try again.'); }
}

const fileInput = $('#play-file');
for (const id of ['#play-import', '#play-import-2', '#play-import-3']) $(id).addEventListener('click', () => { $('#play-picker').open = false; fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => importFile(fileInput.files[0]));
for (const id of ['#play-sample', '#play-sample-2']) $(id).addEventListener('click', () => { $('#play-picker').open = false; loadSample(); });
$('#play-help-btn').addEventListener('click', () => { $('#play-picker').open = false; play.help = true; renderPlay(); });
$('#play-help-close').addEventListener('click', () => { play.help = false; renderPlay(); });
$('#play-part').addEventListener('change', (e) => { state.playPart = Number(e.target.value); loadPiece(play.xml); });
$('#play-wide').addEventListener('click', () => { state.playWide = !state.playWide; save(); renderPlay(); });
$('#play-mic').addEventListener('click', () => micBtn.click());
// ↺: back to the start point you chose; tap again (or if you're already there) for the start of the piece
$('#play-restart').addEventListener('click', () => {
  stopPlayDemo();
  const to = play.index !== state.playStart ? state.playStart : 0;
  if (to === 0) state.playStart = 0;
  play.index = to; play.started = 0; play.lastRun = 0; play.fw.lastMatched = null; play.browse = null;
  state.playIndex = to; save(); renderPlay();
});
$('#play-hear').addEventListener('click', () => playDemo2());
// Drop a file anywhere on the page
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); importFile(e.dataTransfer.files[0]); } });

/** One analysis frame in Play mode. */
function playFrame(frame) {
  const t = play.events[play.index];
  if (play.demo || !t) return;
  if (followFrame(play.fw, frame, t.midi)) playAdvance();
  fretboard.show(wrongNote(play.fw, frame, play.events[play.index]?.midi));
}
function playTap(midi, s, f) {
  const t = play.events[play.index];
  if (play.demo || !t) { fretboard.show(midi, { s, f }); return; }
  if (midi === t.midi) { fretboard.show(null); playAdvance(); } else fretboard.show(midi, { s, f });
}
function playAdvance() {
  const now = performance.now();
  const at = play.fingering[play.index];
  if (at) fretboard.flash(at.s, at.f);
  fretboard.show(null);
  play.fw.lastMatched = play.events[play.index].midi;
  play.fw.wrongMidi = null;
  if (!play.started) play.started = now;
  play.browse = null; // playing: the stave follows you again
  play.index++;
  if (play.index >= play.events.length) { // the end: note the time and go round again (from your start point)
    play.lastRun = now - play.started;
    play.index = Math.min(state.playStart, play.events.length - 1);
    play.started = 0;
    const card = $('#play-card');
    card.classList.remove('lap'); void card.offsetWidth; card.classList.add('lap');
  }
  state.playIndex = play.index;
  save();
  renderPlay();
}

function renderPlay() {
  const active = state.view === 'play';
  document.body.classList.toggle('wide', state.playWide);
  document.body.classList.toggle('has-piece', !!play.score);
  $('#play-wide').setAttribute('aria-pressed', String(state.playWide));
  $('#play-wide').setAttribute('aria-label', state.playWide ? 'Normal width' : 'Full width');
  $('#play-mic').setAttribute('aria-pressed', String(listener.running));
  const { score, events, fingering, index } = play;
  const t = events[index], nx = events[index + 1] || null;
  if (!active) { fretboard.setPlay(null); $('#stave').hidden = false; return; }
  listener.tracker.expect = t && !play.demo ? midiToFreq(t.midi) : null;
  fretboard.setPlay(t ? { target: fingering[index], next: nx ? fingering[index + 1] : null } : { target: null, next: null });

  const showHelp = !score || play.help;
  $('#stave').hidden = showHelp;
  $('#play-help').hidden = !showHelp;
  $('#play-help-close').hidden = !score;
  $('#play-title').textContent = score ? score.title : 'No piece yet';
  $('#play-meta').innerHTML = score
    ? `<b>${escapeHtml(score.title)}</b>${escapeHtml([score.composer, score.parts.length > 1 ? `${score.parts.length} parts` : ''].filter(Boolean).join(' · ') || play.name)}`
    : 'Import a MusicXML file, or load the sample to try it out.';
  $('#play-bar').style.transform = `scaleX(${events.length ? index / events.length : 0})`;
  if (!score || !t) {
    $('#play-label').textContent = 'Play';
    $('#play-note').textContent = '';
    $('#play-oct').textContent = '';
    $('#play-where').textContent = score ? 'No playable notes in this part' : 'Import a MusicXML file to start';
    $('#play-count').textContent = '';
    return;
  }
  const at = fingering[index];
  const toStart = index !== state.playStart && state.playStart > 0;
  $('#play-restart').title = toStart ? `Back to your start point (bar ${score.measures[events[state.playStart].m].number})` : 'Back to the start of the piece';
  $('#play-restart').setAttribute('aria-label', $('#play-restart').title);
  $('#play-label').textContent = play.started ? 'Next' : 'Start';
  $('#play-note').textContent = LETTER_NAMES[t.letter] + ACC_TEXT[t.alter];
  $('#play-oct').textContent = Math.floor((t.midi - t.alter - NATURAL[t.letter]) / 12) - 1;
  $('#play-where').textContent = `${at.f === 0 ? 'open' : `fret ${at.f}`} · string ${6 - at.s}`;
  const secs = Math.max(1, Math.round(play.lastRun / 1000));
  const lastRun = play.lastRun ? ` · last ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '';
  const lastBar = score.measures[score.measures.length - 1].number;
  $('#play-count').innerHTML = `Bar ${score.measures[t.m].number} of ${lastBar}<span class="count-extra"> · ${index + 1} of ${events.length}</span>${lastRun}`;
  if (!showHelp) {
    const box = $('#stave').getBoundingClientRect();
    const view = shownBars();
    renderScore($('#stave'), score, { ...view, cur: t, next: nx, minWidth: state.playWide ? 520 : 200, fit: { w: box.width, h: box.height } });
    // browsing controls
    const N = score.measures.length, last = view.start + view.count - 1;
    $('#bar-nav').hidden = N <= view.count;
    $('#bar-seek').max = String(Math.max(0, N - view.count));
    $('#bar-seek').value = String(view.start);
    $('#bar-seek').style.setProperty('--pct', `${N > view.count ? view.start / (N - view.count) * 100 : 0}%`);
    $('#bar-prev').disabled = view.start <= 0;
    $('#bar-next').disabled = last >= N - 1;
    const tiny = innerWidth <= 720 && innerHeight <= 500;
    $('#bar-pos').textContent = view.count > 1 ? `Bars ${score.measures[view.start].number}–${score.measures[last].number} of ${score.measures[N - 1].number}`
      : tiny ? `${score.measures[view.start].number}/${score.measures[N - 1].number}` : `Bar ${score.measures[view.start].number} / ${score.measures[N - 1].number}`;
    const away = t.m < view.start || t.m > last;
    $('#bar-now').hidden = !away;
    $('#bar-now').textContent = `↩ ${score.measures[t.m].number}`;
    $('#bar-now').title = `Back to bar ${score.measures[t.m].number}, where you're up to`;
    // sections: tap one to look at it
    const strip = $('#section-strip');
    strip.hidden = !state.playWide || !score.sections?.length;
    if (!strip.hidden) strip.innerHTML = '<span class="chip-label">Sections</span>' + score.sections.map((sec) =>
      `<button type="button" class="sec${sec.bar >= view.start && sec.bar <= last ? ' here' : ''}" data-bar="${sec.bar}">${escapeHtml(sec.label)} <small>${sec.number}</small></button>`).join('');
  } else { $('#bar-nav').hidden = true; $('#section-strip').hidden = true; }
}

/** The bars on the stave: the ones around the note to play, unless you're browsing. */
function shownBars() {
  const { score } = play;
  const t = play.events[play.index];
  const count = Math.min(state.playWide ? 4 : 1, score.measures.length);
  if (play.browse === null) return barWindow(score, t ? t.m : 0, state.playWide);
  return { start: Math.max(0, Math.min(play.browse, score.measures.length - count)), count };
}
function browseTo(bar) {
  if (!play.score) return;
  const count = Math.min(state.playWide ? 4 : 1, play.score.measures.length);
  play.browse = Math.max(0, Math.min(bar, play.score.measures.length - count));
  renderPlay();
}
const browsePage = (dir) => { if (play.score) browseTo(shownBars().start + dir * shownBars().count); };
$('#bar-prev').addEventListener('click', () => browsePage(-1));
$('#bar-next').addEventListener('click', () => browsePage(1));
$('#bar-seek').addEventListener('input', (e) => browseTo(Number(e.target.value)));
$('#bar-now').addEventListener('click', () => { play.browse = null; renderPlay(); });
$('#section-strip').addEventListener('click', (e) => { const b = e.target.closest('[data-bar]'); if (b) browseTo(Number(b.dataset.bar)); });

// Swipe or scroll the stave to look through the piece; tap a note (or a bar) to start from there.
{
  const stave = $('#stave');
  let downX = null, swiped = false, wheel = 0, wheelTimer;
  stave.addEventListener('pointerdown', (e) => { if (state.view === 'play') { downX = e.clientX; swiped = false; } });
  stave.addEventListener('pointerup', (e) => {
    if (downX === null || state.view !== 'play') return;
    const dx = e.clientX - downX; downX = null;
    if (Math.abs(dx) > 40) { swiped = true; browsePage(dx < 0 ? 1 : -1); }
  });
  stave.addEventListener('wheel', (e) => {
    if (state.view !== 'play' || !play.score) return;
    e.preventDefault();
    wheel += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(wheel) > 60) { browsePage(wheel > 0 ? 1 : -1); wheel = 0; }
    clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { wheel = 0; }, 200);
  }, { passive: false });
  stave.addEventListener('click', (e) => {
    if (state.view !== 'play' || !play.score || swiped) { swiped = false; return; }
    const noteEl = e.target.closest('[data-m]'), barEl = e.target.closest('[data-bar]');
    if (!noteEl && !barEl) return;
    const m = Number((noteEl || barEl).dataset.m ?? barEl.dataset.bar), n = noteEl ? Number(noteEl.dataset.n) : -1;
    const idx = play.events.findIndex((ev) => ev.m > m || (ev.m === m && ev.n >= n));
    if (idx < 0) return;
    startFrom(idx);
  });
}
/** Start playing from this note. */
function startFrom(idx) {
  stopPlayDemo();
  play.index = idx; play.started = 0; play.browse = null; play.fw.lastMatched = null;
  state.playIndex = idx; state.playStart = idx; save();
  // let you hear it, but not while listening: the mic would take the sound as you playing it and skip on
  if (!listener.running) listener.pluck(play.events[idx].midi, 0.6);
  renderPlay();
}
document.addEventListener('keydown', (e) => {
  if (state.view !== 'play' || !play.score || e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowRight') browsePage(1);
  if (e.key === 'ArrowLeft') browsePage(-1);
});

/** Hear the piece from the current note, in time with the metronome's tempo. */
function playDemo2() {
  if (play.demo) { stopPlayDemo(); renderPlay(); return; }
  if (!play.score || !play.events.length) return;
  const beat = 60 / state.bpm * 1000;
  const startAt = new Map(); // bar index → its start, in beats
  let acc = 0;
  play.score.measures.forEach((m, i) => { startAt.set(i, acc); acc += m.length || m.beats; });
  const when = (e) => startAt.get(e.m) + play.score.measures[e.m].notes[e.n].start;
  const from = play.index, t0 = when(play.events[from]);
  const timers = [];
  play.events.slice(from).forEach((e, k) => {
    timers.push(setTimeout(() => {
      listener.pluck(e.midi, 0.7);
      play.index = from + k;
      renderPlay();
      const p = play.fingering[from + k];
      if (p) fretboard.flash(p.s, p.f);
    }, (when(e) - t0) * beat));
  });
  const last = play.events[play.events.length - 1];
  timers.push(setTimeout(() => { stopPlayDemo(); renderPlay(); }, (when(last) - t0 + last.beats) * beat + 200));
  play.demo = timers;
  play.demoFrom = from;
  $('#play-hear').setAttribute('aria-pressed', 'true');
}
function stopPlayDemo() {
  if (!play.demo) return;
  play.demo.forEach(clearTimeout);
  play.demo = null;
  play.index = play.demoFrom ?? play.index;
  $('#play-hear').setAttribute('aria-pressed', 'false');
}

// ---------- Chords: look a chord up, draw one to name it, practise plucking it ----------
const chord = { shapes: [], all: [], practice: false, path: [], index: 0, started: 0, lastRun: 0, fw: makeFollower(), sel: 0, trail: [], suggestions: [], demo: null };
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const MINOR_TYPES = ['min', 'm7', 'm6', 'm9', 'dim', 'm7b5', 'dim7'];

$('#chord-root').innerHTML = CHORD_ROOTS.map((r) => `<option value="${r.pc}">${r.label}</option>`).join('');
$('#chord-type').innerHTML = CHORD_TYPES.map((t) => `<option value="${t.id}">${t.suffix || 'maj'} — ${t.name}</option>`).join('');
$('#chord-root').addEventListener('change', (e) => { state.chordRoot = Number(e.target.value); state.chordShape = 0; chordChanged(); });
$('#chord-type').addEventListener('change', (e) => { state.chordType = e.target.value; state.chordShape = 0; chordChanged(); });
// Draw and Pluck work like tabs: one tap goes straight to that mode, tap it again to leave it.
$('#chord-draw').addEventListener('click', () => {
  stopLoop();
  if (chord.practice) { stopPractice(); state.chordDraw = true; } else state.chordDraw = !state.chordDraw;
  chordChanged();
});
$('#chord-practice').addEventListener('click', () => {
  stopLoop();
  if (chord.practice) { stopPractice(); renderChord(); return; }
  // nothing drawn yet: practise the chosen chord instead of doing nothing
  if (state.chordDraw && !state.chordDrawn.some((f) => f >= 0)) { state.chordDraw = false; save(); applyAll(); }
  startPractice();
  renderChord();
});
$('#chord-hear').addEventListener('click', () => strum(currentFrets()));
$('#chord-tools').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.shape) { state.chordShape = (state.chordShape + Number(b.dataset.shape) + chord.shapes.length) % chord.shapes.length; chordChanged(); return; }
  if (b.dataset.next !== undefined) {
    const i = Number(b.dataset.next);
    stopLoop();
    if (chord.sel === i) moveTo(chord.suggestions[i]); // second tap: move on to it
    else { chord.sel = i; const sg = chord.suggestions[i]; if (sg?.shape) strum(sg.shape.frets, 0.4); } // first tap: preview it
    chordChanged(); return;
  }
  if (b.dataset.done !== undefined) { state.chordDone = true; chord.sel = 0; strum(state.chordDrawn); chordChanged(); return; }
  if (b.dataset.undo !== undefined) { stopLoop(); const last = state.chordProg.pop(); if (last) { state.chordDrawn = last.frets.slice(); state.chordDone = true; } chord.sel = 0; chordChanged(); return; }
  if (b.dataset.clear !== undefined) { stopLoop(); state.chordDrawn = state.chordDrawn.map(() => -1); state.chordProg = []; state.chordDone = false; chord.sel = 0; chordChanged(); return; }
  if (b.dataset.loop !== undefined) { chord.loop ? stopLoop() : startLoop(); renderChord(); }
});
// Tap an earlier chord in the progression to go back to it
$('#chord-count').addEventListener('click', (e) => {
  const b = e.target.closest('[data-back]');
  if (!b) return;
  stopLoop();
  const i = Number(b.dataset.back);
  state.chordDrawn = state.chordProg[i].frets.slice();
  state.chordProg = state.chordProg.slice(0, i);
  state.chordDone = true;
  chord.sel = 0;
  chordChanged();
});

/** Keep the current chord in the progression and move on to a suggested one. */
function moveTo(sg) {
  if (!sg?.shape) return;
  const info = chordInfo();
  state.chordProg.push({ rootPc: info?.rootPc ?? null, typeId: info?.typeId ?? null, name: info?.name || '?', frets: state.chordDrawn.slice() });
  state.chordDrawn = sg.shape.frets.slice();
  state.chordDone = true; // a suggested chord is complete already
  chord.sel = 0;
  strum(state.chordDrawn);
}
/** The progression so far, as chords (the current one last); unnamed chords are skipped. */
function progChords() {
  const info = chordInfo();
  return [...state.chordProg, info].filter((c) => c && c.typeId).map((c) => ({ rootPc: c.rootPc, typeId: c.typeId }));
}

/** Loop the progression, one chord per bar at the metronome's tempo. */
function startLoop() {
  const info = chordInfo();
  const seq = [...state.chordProg, { name: info?.name || '?', frets: state.chordDrawn.slice() }].filter((c) => c.frets.some((f) => f >= 0));
  if (seq.length < 2) return;
  chord.loop = { seq, i: 0, timers: [] };
  const bar = 4 * 60 / state.bpm * 1000;
  const tick = () => {
    if (!chord.loop) return;
    const fr = seq[chord.loop.i].frets;
    strum(fr);
    chord.loop.timers = [setTimeout(() => chord.loop && strum(fr, 0.3), bar / 2), setTimeout(() => { if (!chord.loop) return; chord.loop.i = (chord.loop.i + 1) % seq.length; tick(); }, bar)];
    renderChord();
  };
  tick();
}
function stopLoop() {
  if (!chord.loop) return;
  chord.loop.timers.forEach(clearTimeout);
  chord.loop = null;
}

const fretNotes = (frets) => { const t = currentTuning().notes; return frets.map((f, s) => (f < 0 ? null : t[s] + f)).filter((x) => x !== null); };
function chordInfo() {
  if (state.chordDraw) return identifyChord(fretNotes(state.chordDrawn));
  const sp = chordSpelling(state.chordRoot, state.chordType);
  return { rootPc: state.chordRoot, typeId: state.chordType, name: chordName(state.chordRoot, state.chordType), notes: [...sp.values()].map((x) => x.name) };
}
function chordPref() {
  const info = chordInfo();
  if (!info?.typeId) return currentTuning().pref;
  return [...chordSpelling(info.rootPc, info.typeId).values()].some((x) => x.acc < 0) ? 'flat' : 'sharp';
}
function chordLabel(midi) {
  const info = chordInfo();
  const sp = info?.typeId ? chordSpelling(info.rootPc, info.typeId).get(((midi % 12) + 12) % 12) : null;
  return sp ? sp.name : noteName(midi, chordPref());
}
const currentFrets = () => (state.chordDraw ? (chord.loop ? chord.loop.seq[chord.loop.i].frets : state.chordDrawn) : chord.shapes[state.chordShape]?.frets || []);

function chordChanged() { save(); applyAll(); }

/** Tuning or chord changed: work out the shapes (and, when drawing, where to go next). */
function rebuildChord() {
  const { notes } = currentTuning();
  if (state.chordDrawn.length !== notes.length) state.chordDrawn = notes.map(() => -1);
  chord.all = chordShapes(notes, state.chordRoot, state.chordType, FRETS);
  chord.shapes = distinctShapes(chord.all);
  if (state.chordShape >= chord.shapes.length) state.chordShape = 0;
  // Draw: work out the key from the progression, then where to go next and the easiest shape to change to
  chord.suggestions = [];
  chord.key = null;
  if (state.chordDraw) {
    const prog = progChords();
    chord.key = prog.length ? detectKey(prog) : null;
    if (state.chordDone && chordInfo()?.typeId) {
      chord.suggestions = suggestNext(prog, chord.key).map((sg) => ({ ...sg, ...easiestChange(chordShapes(notes, sg.rootPc, sg.typeId, FRETS), state.chordDrawn) }));
    }
    if (chord.sel >= chord.suggestions.length) chord.sel = 0;
  }
  $('#chord-root').value = String(state.chordRoot);
  $('#chord-type').value = state.chordType;
  if (chord.practice) buildPracticePath();
  renderChord();
}

function drawTap(s, f) {
  stopLoop();
  state.chordDrawn[s] = state.chordDrawn[s] === f ? -1 : f; // tap again to take it off
  state.chordDone = false; // changing the chord: back to drawing until Done
  chord.sel = 0;
  chordChanged();
}

/** Practice: the chord's notes one at a time, from the root upwards (then any strings below it). */
function buildPracticePath() {
  const { notes } = currentTuning();
  const frets = currentFrets();
  const info = chordInfo();
  const strings = frets.map((f, s) => (f >= 0 ? { s, f, midi: notes[s] + f } : null)).filter(Boolean).sort((a, b) => a.midi - b.midi);
  const r = info?.rootPc ?? null;
  const k = r === null ? 0 : Math.max(0, strings.findIndex((x) => ((x.midi - r) % 12 + 12) % 12 === 0));
  chord.path = [...strings.slice(k), ...strings.slice(0, k)];
  if (chord.index >= chord.path.length) chord.index = 0;
}
function startPractice() {
  chord.practice = true; chord.index = 0; chord.started = 0; chord.lastRun = 0; chord.fw.lastMatched = null;
  buildPracticePath();
}
function stopPractice() { chord.practice = false; chord.index = 0; if (state.view === 'chords') listener.tracker.expect = null; }

function chordFrame(frame) {
  if (!chord.practice) { fretboard.show(frame.active ? frame.midi : null); return; } // just show what's heard
  const t = chord.path[chord.index];
  if (!t) return;
  if (followFrame(chord.fw, frame, t.midi)) chordAdvance();
  fretboard.show(wrongNote(chord.fw, frame, chord.path[chord.index]?.midi));
}
function chordTap(midi, s, f) {
  if (!chord.practice) { fretboard.show(midi, { s, f }); return; }
  const t = chord.path[chord.index];
  if (t && midi === t.midi) { fretboard.show(null); chordAdvance(); } else fretboard.show(midi, { s, f });
}
function chordAdvance() {
  const now = performance.now();
  const t = chord.path[chord.index];
  fretboard.flash(t.s, t.f);
  fretboard.show(null);
  chord.fw.lastMatched = t.midi;
  if (!chord.started) chord.started = now;
  chord.index++;
  if (chord.index >= chord.path.length) {
    chord.lastRun = now - chord.started; chord.started = 0; chord.index = 0;
    const card = $('#chord-card');
    card.classList.remove('lap'); void card.offsetWidth; card.classList.add('lap');
  }
  renderChord();
}

function strum(frets, volume = 0.55) {
  const { notes } = currentTuning();
  frets.forEach((f, s) => { if (f >= 0) setTimeout(() => listener.pluck(notes[s] + f, volume), s * 45); });
}

function renderChord() {
  const active = state.view === 'chords';
  if (!active) { fretboard.setChord(null); return; }
  const info = chordInfo();
  const frets = currentFrets();
  const has = frets.some((f) => f >= 0);
  const drawing = state.chordDraw;
  $('#chord-draw').setAttribute('aria-pressed', String(drawing && !chord.practice));
  $('#chord-practice').setAttribute('aria-pressed', String(chord.practice));
  $('#chord-practice').disabled = !has && !chord.shapes.length;
  $('#chord-picker').classList.toggle('disabled', drawing && !chord.practice);
  $('#chord-title').textContent = drawing ? 'Draw a chord' : chordName(state.chordRoot, state.chordType);
  if (drawing) $('#chord-picker').open = false;

  // fretboard
  let ghosts = [], stay = [];
  const sug = drawing && !chord.loop && state.chordDone ? chord.suggestions[chord.sel] : null;
  if (!chord.practice) {
    if (drawing) { if (sug?.shape) { ghosts = sug.shape.frets.map((f, s) => (f >= 0 ? { s, f } : null)).filter(Boolean); stay = sug.stay; } }
    else chord.shapes.forEach((sh, i) => { if (i !== state.chordShape) sh.frets.forEach((f, s) => { if (f >= 0) ghosts.push({ s, f }); }); });
  }
  const target = chord.practice ? chord.path[chord.index] : null;
  listener.tracker.expect = target ? midiToFreq(target.midi) : null;
  const shownInfo = chord.loop ? identifyChord(fretNotes(frets)) : info;
  fretboard.setChord({ main: has ? frets : null, rootPc: shownInfo?.rootPc ?? -1, ghosts, stay, target, done: chord.practice ? chord.path.slice(0, chord.index) : [] });

  // card
  const named = info?.name;
  $('#chord-name').textContent = has || !drawing ? (named || '?') : '—';
  $('#chord-notes').textContent = !has && drawing ? 'Tap the neck to draw a chord — one note per string, tap again to remove'
    : named ? `${info.notes.join(' · ')}${drawing ? '' : ` · ${chordType(state.chordType).name}`}`
    : `${fretNotes(frets).map((m) => noteName(m, chordPref())).join(' · ')} — no common chord name`;
  const tools = $('#chord-tools');
  $('#chord-progress').hidden = !chord.practice;
  if (chord.practice) {
    const t = chord.path[chord.index];
    $('#chord-label').textContent = `${chord.started ? 'Next' : 'Pluck'}${chord.index === 0 && info?.rootPc !== null ? ' · root' : ''}`;
    $('#chord-notes').textContent = t ? `${chordLabel(t.midi)} · ${t.f === 0 ? 'open' : `fret ${t.f}`} · string ${6 - t.s}` : '';
    $('#chord-bar').style.transform = `scaleX(${chord.path.length ? chord.index / chord.path.length : 0})`;
    const secs = chord.lastRun ? (chord.lastRun / 1000).toFixed(1) : '';
    $('#chord-count').textContent = `${chord.index + 1} of ${chord.path.length}${secs ? ` · last ${secs}s — then strum it` : ''}`;
    tools.innerHTML = '';
  } else if (drawing) {
    const key = chord.key;
    const showing = chord.loop ? shownInfo : info; // while looping: the chord being played
    const cur = showing?.typeId ? numeral(showing, key || { tonic: showing.rootPc, mode: 'major' }) : '';
    const done = state.chordDone || !!chord.loop;
    $('#chord-label').innerHTML = !has ? 'Draw' : !done ? 'Drawing…' : key && showing?.typeId ? `${key.name}${key.sure ? '' : ' ?'} · <span class="num">${cur}</span>` : 'You drew';
    if (chord.loop) {
      $('#chord-name').textContent = chord.loop.seq[chord.loop.i].name;
      $('#chord-notes').textContent = showing?.notes ? `${showing.notes.join(' · ')} — playing bar ${chord.loop.i + 1} of ${chord.loop.seq.length}` : '';
    }
    const group = (g, label) => {
      const items = chord.suggestions.map((x, i) => ({ x, i })).filter(({ x }) => x.group === g);
      return items.length ? `<span class="chip-label">${label}</span>` + items.map(({ x, i }) =>
        `<button class="chip ${g}" type="button" data-next="${i}" aria-pressed="${i === chord.sel}" title="${x.numeral} — ${x.why}${i === chord.sel ? ' · tap again to use it' : ''}">${x.name}</button>`).join('') : '';
    };
    const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
    tools.innerHTML = (done ? group('safe', 'Next') + group('tension', 'Tension') + group('surprise', 'Surprise')
        : has ? `<button class="btn primary small done-btn" type="button" data-done title="Finished drawing: show where to go next">${icon('M4 12l5 5L20 6')}<span>Done</span></button>` : '')
      + `<span class="tools-gap"></span>`
      + (state.chordProg.length ? `<button class="btn icon act" type="button" data-loop aria-pressed="${!!chord.loop}" aria-label="${chord.loop ? 'Stop' : 'Loop the progression'}" title="${chord.loop ? 'Stop' : 'Loop the progression (metronome tempo)'}">${icon(chord.loop ? 'M6 6h12v12H6z' : 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4')}</button>` : '')
      + (state.chordProg.length ? `<button class="btn icon act" type="button" data-undo aria-label="Back one chord" title="Back one chord">${icon('M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3')}</button>` : '')
      + (has || state.chordProg.length ? `<button class="btn icon act" type="button" data-clear aria-label="Clear" title="Start again">${icon('M6 6l12 12M18 6L6 18')}</button>` : '');
    // the progression, with roman numerals; tap an earlier chord to go back to it
    const k = key || (info?.typeId ? { tonic: info.rootPc, mode: 'major' } : null);
    const num = (c) => (k && c.typeId ? `<sub>${numeral(c, k)}</sub>` : '');
    const playing = chord.loop ? chord.loop.i : -1;
    const steps = state.chordProg.map((c, i) => `<button class="prog-step${playing === i ? ' playing' : ''}" type="button" data-back="${i}" title="Go back to ${c.name}">${c.name}${num(c)}</button>`);
    if (has) steps.push(`<b class="prog-step now${playing === state.chordProg.length ? ' playing' : ''}">${info?.name || '?'}${info?.typeId ? num(info) : ''}</b>`);
    $('#chord-count').innerHTML = steps.length ? steps.join('<span class="prog-arrow">→</span>') + (sug ? `<span class="prog-arrow">→</span><span class="prog-next">${sug.name}?</span>` : '') : '';
    if (!chord.loop) $('#chord-notes').textContent = !has ? 'Tap the neck to draw a chord — one note per string, tap again to remove'
      : !done ? `${named ? info.notes.join(' · ') + ' — ' : ''}tap Done when the chord's finished`
      : sug ? `${(named ? info.notes.join(' · ') + ' — ' : '')}${sug.name} (${sug.numeral}): ${sug.why}${sug.stay?.length ? ` · ${sug.stay.length} finger${sug.stay.length > 1 ? 's' : ''} stay put` : ''}`
      : $('#chord-notes').textContent;
  } else {
    $('#chord-label').textContent = 'Chord';
    const n = chord.shapes.length;
    const sh = chord.shapes[state.chordShape];
    tools.innerHTML = n ? `<button class="btn icon" type="button" data-shape="-1" aria-label="Previous shape"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>`
      + `<span class="shape-num">${state.chordShape + 1}/${n}</span>`
      + `<button class="btn icon" type="button" data-shape="1" aria-label="Next shape"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>`
      + `<span class="shape-where">${sh.minFret === 0 || sh.frets.includes(0) && sh.minFret <= 3 ? 'Open' : `${sh.barre ? 'Barre' : 'Fret'} ${sh.minFret}`}</span>` : '';
    $('#chord-count').textContent = n ? '' : 'No shape in this tuning';
  }

  $('#chord-card').classList.toggle('long-name', $('#chord-name').textContent.length > 4);
  // stave: the chord's notes stacked
  renderChordStave(frets, info);
}

function renderChordStave(frets, info) {
  const midis = [...new Set(fretNotes(frets))].sort((a, b) => a - b);
  const host = $('#stave');
  if (!midis.length) { renderStave(host, null, chordPref(), { compact: staveCompact() }); return; }
  const sp = info?.typeId ? chordSpelling(info.rootPc, info.typeId) : null;
  const pitches = midis.map((m) => {
    const x = sp?.get(((m % 12) + 12) % 12);
    if (x) return { letter: x.letter, alter: x.acc, midi: m, octave: Math.floor((m + 12 - x.acc - NATURAL_PC[x.letter]) / 12) - 1 };
    const w = spell(m + 12, chordPref());
    return { letter: w.letter, alter: w.acc, midi: m, octave: w.octave };
  });
  const score = { measures: [{ number: '', key: 0, time: { beats: 4, beatType: 4 }, keyChanged: false, timeChanged: false, beats: 4, length: 4,
    notes: [{ start: 0, beats: 4, type: 'whole', dots: 0, rest: false, pitches, beams: {}, tieStart: false, tieStop: false }] }] };
  const box = host.getBoundingClientRect();
  renderScore(host, score, { start: 0, count: 1, minWidth: 150, fit: { w: box.width, h: box.height }, single: true });
}

let lastReadoutKey = '';
function showReadout(midi, frame, stale) {
  if (state.view === 'learn' || state.view === 'play' || state.view === 'chords') { fretboard.svg?.classList.toggle('stale', stale); return; }
  const pref = notePref();
  $('#note-card').classList.toggle('stale', stale && midi !== null);
  fretboard.svg?.classList.toggle('stale', stale);
  const cents = frame ? frame.cents : 0;
  const inTune = !!frame && Math.abs(cents) <= 5;
  $('#note-card').classList.toggle('in-tune', inTune && !stale);
  fretboard.setInTune(inTune && !stale);
  $('#mini-needle').style.transform = `translateX(${Math.max(-50, Math.min(50, cents))}%)`;
  $('#note-hz').textContent = frame ? frame.freq.toFixed(1) : '—';
  $('#note-cents').textContent = frame ? `${cents > 0 ? '+' : cents < 0 ? '−' : '±'}${Math.abs(cents).toFixed(0)}¢` : '';

  // Everything below only changes when the note changes — skip DOM work otherwise.
  const key = `${midi}|${pref}|${state.tuningId}|${state.custom}|${FRETS}|${staveCompact()}`;
  if (key === lastReadoutKey) return;
  lastReadoutKey = key;
  if (midi === null) {
    $('#note-name').textContent = '—';
    $('#note-oct').textContent = '';
    $('#note-enh').textContent = listener.running ? 'Play a single note' : 'Start listening, or tap the fretboard';
    renderStave($('#stave'), null, pref, { compact: staveCompact() });
    return;
  }
  $('#note-name').textContent = noteName(midi, pref);
  $('#note-oct').textContent = octaveOf(midi);
  const enh = enharmonic(midi);
  $('#note-enh').textContent = enh.includes('/') ? enh : '';
  renderStave($('#stave'), midi, pref, { compact: staveCompact() });
}

// ---------- metronome ----------
const metro = new Metronome(() => listener.audioContext(), (beat) => {
  document.querySelectorAll('.metro-beats span').forEach((el, i) => {
    el.classList.toggle('on', i === beat);
    el.classList.toggle('accent', i === beat && beat === 0);
  });
  $('#metro').classList.toggle('tick', beat >= 0);
  if (beat >= 0) { $('#metro').classList.remove('flash'); void $('#metro').offsetWidth; $('#metro').classList.add('flash'); }
});
function showBpm() {
  metro.setBpm(state.bpm);
  $('#metro-value').textContent = metro.bpm;
}
function toggleMetro() {
  metro.toggle();
  for (const id of ['#metro-play', '#metro-bpm']) {
    $(id).setAttribute('aria-pressed', String(metro.running));
    $(id).setAttribute('aria-label', metro.running ? 'Stop metronome' : 'Start metronome');
  }
  $('#metro').classList.toggle('running', metro.running);
}
$('#metro-play').addEventListener('click', toggleMetro);
$('#metro-bpm').addEventListener('click', toggleMetro);
// −/+ step by 1; hold to keep going (speeds up the longer you hold)
for (const [id, dir] of [['#metro-down', -1], ['#metro-up', 1]]) {
  const btn = $(id);
  let timer, held;
  const step = () => { state.bpm = Math.max(30, Math.min(260, state.bpm + dir * (held > 8 ? 5 : 1))); showBpm(); save(); };
  const stopHold = () => { clearTimeout(timer); timer = null; };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); held = 0; step();
    const again = () => { held++; step(); timer = setTimeout(again, held > 8 ? 90 : 160); };
    timer = setTimeout(again, 400);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stopHold);
}
showBpm();

// ---------- boot ----------
// Bring back the last piece
try {
  const saved = JSON.parse(localStorage.getItem(PIECE_KEY) || 'null');
  if (saved?.xml) loadPiece(saved.xml, { name: saved.name, keepIndex: true, store: false });
} catch { /* nothing saved */ }
setView(state.view);
applyAll();
