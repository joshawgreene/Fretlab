import { TUNINGS, parseNote, setA4, noteName, octaveOf, enharmonic, customNoteRange } from './notes.js';
import { PitchListener } from './audio.js';
import { Fretboard } from './fretboard.js';
import { renderStave } from './stave.js';
import { Tuner } from './tuner.js';

const $ = (s) => document.querySelector(s);
const STORE_KEY = 'fretlab:v1';

// ---------- state (persisted per browser) ----------
const defaults = {
  view: 'fretboard',
  tuningId: 'standard',
  custom: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'].map(parseNote),
  pref: 'auto',
  frets: 15,
  showNames: false,
  a4: 440,
  sensitivity: 0.55,
};
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
const notePref = () => (state.pref === 'auto' ? currentTuning().pref : state.pref);

// Phones in landscape always get the full neck; the "Frets shown" setting is for bigger screens.
const phoneLandscape = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
const fretsShown = () => (phoneLandscape.matches ? 22 : state.frets);
phoneLandscape.addEventListener('change', () => applyAll());

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
  setA4(state.a4);
  listener.setSensitivity(state.sensitivity);
  tuningSelect.value = state.tuningId;
  $('#pref-select').value = state.pref;
  $('#frets-select').value = String(state.frets);
  $('#a4-input').value = state.a4;
  $('#a4-out').textContent = state.a4;
  $('#sens-input').value = state.sensitivity;
  $('#names-toggle').checked = state.showNames;
  fretboard.configure({ tuning: notes, frets: fretsShown(), pref, showNames: state.showNames });
  tuner.setTuning(notes, pref);
  renderCustomEditor();
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
tuningSelect.addEventListener('change', () => { state.tuningId = tuningSelect.value; fretboard.clearTrail(); applyAll(); });
$('#pref-select').addEventListener('change', (e) => { state.pref = e.target.value; applyAll(); });
$('#frets-select').addEventListener('change', (e) => { state.frets = Number(e.target.value); applyAll(); });
$('#a4-input').addEventListener('input', (e) => { state.a4 = Number(e.target.value); applyAll(); });
$('#sens-input').addEventListener('input', (e) => { state.sensitivity = Number(e.target.value); listener.setSensitivity(state.sensitivity); save(); });
$('#names-toggle').addEventListener('change', (e) => { state.showNames = e.target.checked; applyAll(); });
$('#clear-trail').addEventListener('click', () => fretboard.clearTrail());

// Tabs
function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  listener.setTunerMode(view === 'tuner');
  if (view === 'tuner') tuner.update(null, listener.running);
  for (const v of ['fretboard', 'tuner']) {
    $(`#tab-${v}`).setAttribute('aria-selected', String(v === view));
    $(`#view-${v}`).hidden = v !== view;
  }
  save();
}
$('#tab-fretboard').addEventListener('click', () => setView('fretboard'));
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
  const label = listener.running ? 'Stop listening' : 'Start listening';
  $('#mic-label').textContent = label;
  micBtn.setAttribute('aria-label', label);
  document.body.classList.toggle('listening', listener.running);
  if (listener.running) keepAwake(); else releaseWake();
});

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
const levelBar = $('#level-bar');

function onFrame(frame) {
  levelBar.style.transform = `scaleX(${Math.min(1, Math.sqrt(frame.level) * 4)})`;
  if (state.view === 'tuner') tuner.update(frame.tune, listener.running);
  if (frame.active) {
    lastMidi = frame.midi;
    lastFrame = frame;
    if (fretboard.show(frame.midi)) fretboard.revealCurrent();
  }
  showReadout(lastMidi, frame.active ? frame : lastFrame, !frame.active);
}

/** Tap a fretboard position: hear it, and (when not listening) show it. */
function tapNote(midi) {
  listener.pluck(midi);
  if (!listener.running) {
    lastMidi = midi;
    lastFrame = null;
    fretboard.show(midi);
    showReadout(midi, null, false);
  }
}

let lastReadoutKey = '';
function showReadout(midi, frame, stale) {
  const pref = notePref();
  $('#note-card').classList.toggle('stale', stale && midi !== null);
  fretboard.svg?.classList.toggle('stale', stale);
  const cents = frame ? frame.cents : 0;
  const inTune = !!frame && Math.abs(cents) <= 5;
  $('#note-card').classList.toggle('in-tune', inTune && !stale);
  fretboard.setInTune(inTune && !stale);
  $('#mini-needle').style.transform = `translateX(${Math.max(-50, Math.min(50, cents))}%)`;
  $('#note-hz').textContent = frame ? `${frame.freq.toFixed(1)} Hz` : midi !== null ? '' : '— Hz';
  $('#note-cents').textContent = frame ? `${cents > 0 ? '+' : ''}${cents.toFixed(0)}¢` : '';

  // Everything below only changes when the note changes — skip DOM work otherwise.
  const key = `${midi}|${pref}|${state.tuningId}|${state.custom}|${fretsShown()}|${phoneLandscape.matches}`;
  if (key === lastReadoutKey) return;
  lastReadoutKey = key;
  if (midi === null) {
    $('#note-name').textContent = '—';
    $('#note-oct').textContent = '';
    $('#note-enh').textContent = listener.running ? 'Play a single note' : 'Start listening, or tap the fretboard';
    $('#note-positions').textContent = '';
    renderStave($('#stave'), null, pref, { compact: phoneLandscape.matches });
    return;
  }
  $('#note-name').textContent = noteName(midi, pref);
  $('#note-oct').textContent = octaveOf(midi);
  const enh = enharmonic(midi);
  $('#note-enh').textContent = enh.includes('/') ? enh : 'Natural';
  const { notes } = currentTuning();
  const where = notes
    .map((open, i) => ({ string: 6 - i, fret: midi - open }))
    .filter((p) => p.fret >= 0 && p.fret <= fretsShown())
    .map((p) => (p.fret === 0 ? `string ${p.string} open` : `string ${p.string} fret ${p.fret}`));
  $('#note-positions').textContent = where.length ? where.join(' · ') : 'Not on the frets shown';
  renderStave($('#stave'), midi, pref, { compact: phoneLandscape.matches });
}

// ---------- boot ----------
setView(state.view);
applyAll();
