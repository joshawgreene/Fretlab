# Fretlab

Guitar practice in the browser. Play a note and see it on a live fretboard and a music stave; tune to any standard, alternate or custom tuning.

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
node tests/pitch.test.mjs
```

Runs the pitch detector over synthetic plucked strings from C2 to E6 and checks it is (a) almost never confidently wrong and (b) accurate to under a cent on pure tones.

## How it's organised

| File | Job |
|---|---|
| `js/pitch.js` | YIN pitch detection (pure maths, testable in Node) |
| `js/tracker.js` | Smooths raw detections into a steady "current note" (confidence gate, median filter, note debounce) |
| `js/audio.js` | Microphone input + analysis loop, and the plucked reference tone |
| `js/notes.js` | Frequency ↔ note maths, spelling, the tuning presets |
| `js/fretboard.js` | SVG fretboard: draws any tuning, lights every position of a note, fading trail |
| `js/stave.js` | SVG treble-clef-8 stave (guitar notation is written an octave above sounding pitch) |
| `js/tuner.js` | Tuner gauge, string pills, auto/locked string targeting |
| `js/app.js` | Wires it all together; settings persist in localStorage |

Adding a new mode: add a tab + `<section>` in `index.html`, a module in `js/`, and hook it into `setView()` and `onFrame()` in `app.js`.

## Notes and limits

- Single notes only for now. Chords need a different approach (spectrum/chroma analysis).
- Browser voice processing (echo cancellation, noise suppression, auto gain) is switched off on purpose; it wrecks instrument audio.
- On iPhone the mic needs a tap to start (Safari rule) — that's what the *Start listening* button is for.
