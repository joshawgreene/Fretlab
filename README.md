# Fretlab

Guitar practice in the browser.

- **Fretboard** — play a note and see every place it lives on the neck, plus the note on a stave.
- **Learn** — pick a key, scale and position; the scale lights up orange and you play through it note by note.
- **Tuner** — standard, alternate and custom tunings, with a live pitch trace.

No build step and no dependencies — plain HTML, CSS and JavaScript modules.

## Run it locally

The microphone only works on `https://` or `localhost`, and JS modules don't load from `file://`, so use a tiny local server:

```bash
npx serve .            # or: python3 -m http.server 5173
```

Then open the printed `localhost` address.

## Deploy to Vercel

Push this folder to a GitHub repo and import it in Vercel. Framework preset: **Other**, no build command, output directory: `.` (root). Every push to `main` redeploys.

## Tests

```bash
node tests/pitch.test.mjs   # note detector over C2–E6: almost never confidently wrong
node tests/tuner.test.mjs   # tuner: accuracy through a string's decay, smooth peg-turn tracking, string switching
node tests/lowstrings.test.mjs  # low notes as a laptop/phone mic hears them: weak fundamental, ringing strings, echo
node tests/scales.test.mjs  # Learn mode: scale spelling, box shapes, neck paths
```

## How it's organised

| File | Job |
|---|---|
| `js/pitch.js` | YIN pitch detection (pure maths, testable in Node) |
| `js/analysis.js` | One analysis step: samples in, note + tuner readings out (the tuner band-pass filters around the string and uses a longer window) |
| `js/tracker.js` | `NoteTracker` turns raw detections into a steady current note; `TuneTracker` gives the tuner a continuous, glitch-free pitch that holds through the decay |
| `js/audio.js` | Microphone input + analysis loop, and the plucked reference tone |
| `js/notes.js` | Frequency ↔ note maths, spelling, the tuning presets |
| `js/fretboard.js` | SVG fretboard: draws any tuning, lights every position of a note, Learn-mode scale overlay |
| `js/stave.js` | SVG treble-clef-8 stave (guitar notation is written an octave above sounding pitch) |
| `js/tuner.js` | Tuner gauge, pitch trace, string pills, auto/locked string targeting |
| `js/scales.js` | Learn mode: scale definitions, key spelling, positions on the neck, the order to play them |
| `js/app.js` | Wires it all together; settings persist in localStorage |

Adding a new mode: add a tab + `<section>` in `index.html`, a module in `js/`, and hook it into `setView()` and `onFrame()` in `app.js`.

## Notes and limits

- Single notes only for now. Chords need a different approach (spectrum/chroma analysis).
- Browser voice processing (echo cancellation, noise suppression, auto gain) is switched off on purpose; it wrecks instrument audio.
- On iPhone the mic needs a tap to start (Safari rule) — that's what the *Start listening* button is for.
