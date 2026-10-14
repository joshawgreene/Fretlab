# Fretlab

Guitar practice in the browser.

Each mode has its own colour: Frets blue, Learn orange, Play green, Chords purple, Tune black and white.

- **Fretboard** — play a note and see every place it lives on the neck, plus the note on a stave.
- **Learn** — pick a key, scale and position (pentatonic boxes, three-notes-per-string shapes); the scale lights up orange and you play through it, up and back down, round and round with the time of your last run. Options: *Auto position* (move to the next position after each run) and *Arpeggio* (just the root, 3rd and 5th). A blue marker appears only when you hold a wrong note.
- **Play** — import a piece as MusicXML (`.musicxml`, `.mxl`, `.xml`) and play through it note by note: the stave shows one bar (or four, full width) with the next note in green; the fretboard shows where to play it and ghosts the note after. Fretlab picks the fingering, follows the top line of chords, and ignores repeats for now. Every bar is numbered and the score's structure is drawn (rehearsal letters, section names like Verse/Chorus, repeats, 1st/2nd endings, segno/coda); swipe, scroll or use the arrows and bar slider to look through the piece, jump to a section, and tap any note or bar to start from there. Got a PDF or photo? Scan it to MusicXML first (MuseScore's PDF import, Audiveris, PlayScore 2). A sample piece (Ode to Joy) is in `samples/`.
- **Chords** — pick a chord (18 types, any root) to see how to play it: the main shape in purple, other places on the neck faded; step through the shapes. Or draw a chord by tapping the neck to get its name (slash chords too) and build a progression: Fretlab works out the key you're in from the chords so far, labels each with its roman numeral, and suggests where to go next — safe moves in the key (ranked by how often songs make them), a tension chord (the V7 of where you're heading) and a surprise (borrowed from the parallel key). The next chord's shape is the easiest change, with fingers that can stay put marked. Draw the whole chord, then tap Done to see suggestions. Tap a suggestion to preview it, again to move to it. The progression is written on the stave (names above, numerals below): tap any chord there to see how it's played, and carry on from it if you like; loop the progression at the metronome's tempo. Tap the big chord name to hear it. *Practise* has you pluck the chord's notes one by one, root first. Shapes are worked out for any tuning.
- **Tuner** — standard, alternate and custom tunings, with a live pitch trace.
- **Metronome** — always on screen; accented downbeat, unpitched click so the note detector ignores it.

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
node tests/fluid.test.mjs   # fast low-string riffs, ringing strings, hammer-ons: how quickly each new note shows
node tests/scales.test.mjs  # Learn mode: every scale's notes and spelling, the standard position shapes, all 936 positions playable, arpeggios
node tests/learn.test.mjs   # Learn mode at 80–160 BPM: how fast each step ticks off, nothing missed, no stray blue marker
node tests/chords.test.mjs  # Chords: shapes match the chord charts, all shapes valid and playable, naming drawn chords, next-chord ideas
node tests/play.test.mjs    # Play mode: reading MusicXML/.mxl, fingering, repeated notes at tempo, held notes (with vibrato) counted once
```

## How it's organised

| File | Job |
|---|---|
| `js/pitch.js` | YIN pitch detection (pure maths, testable in Node) |
| `js/analysis.js` | One analysis step: samples in, note + tuner readings out. Notes: a fast (~34 ms) and a steady (~85 ms) reading, the fast one winning right after a pluck. In Learn and Play it also listens specifically for the note you're meant to play next (ticks it off sooner) and spots fresh picks, so a repeated note needs — and gets — its own pick. Tuner: band-pass filtered around the string over a longer window |
| `js/tracker.js` | `NoteTracker` turns raw detections into a steady current note; `TuneTracker` gives the tuner a continuous, glitch-free pitch that holds through the decay |
| `js/audio.js` | Microphone input + analysis loop, and the plucked reference tone |
| `js/notes.js` | Frequency ↔ note maths, spelling, the tuning presets |
| `js/fretboard.js` | SVG fretboard: draws any tuning, lights every position of a note, Learn-mode scale overlay |
| `js/stave.js` | SVG treble-clef-8 stave (guitar notation is written an octave above sounding pitch) |
| `js/tuner.js` | Tuner gauge, pitch trace, string pills, auto/locked string targeting |
| `js/scales.js` | Learn mode: scale definitions, letter-correct spelling, standard positions (pentatonic boxes, 3-notes-per-string, blues = box + ♭5) |
| `js/musicxml.js` | Play mode: reads MusicXML (plain or zipped .mxl, no dependencies) into bars of notes in guitar terms |
| `js/score-stave.js` | Play mode: draws one or four bars — clef, key/time signatures, notes, beams, ties, rests |
| `js/fingering.js` | Play mode: picks a string and fret for every note, keeping the hand in one place as long as it can |
| `js/chords.js` | Chords: types and spelling, playable shapes for any tuning, naming a chord from its notes, next-chord suggestions |
| `js/metronome.js` | Metronome scheduled on the audio clock, accented downbeat |
| `js/app.js` | Wires it all together; settings persist in localStorage |

Adding a new mode: add a tab + `<section>` in `index.html`, a module in `js/`, and hook it into `setView()` and `onFrame()` in `app.js`.

## Notes and limits

- Single notes only for now. Chords need a different approach (spectrum/chroma analysis).
- Browser voice processing (echo cancellation, noise suppression, auto gain) is switched off on purpose; it wrecks instrument audio.
- On iPhone the mic needs a tap to start (Safari rule) — that's what the *Start listening* button is for.
