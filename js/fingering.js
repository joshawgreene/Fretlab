// Choose where on the neck to play each note of a piece. Sheet music gives pitches, not strings, so
// this picks the sequence of (string, fret) positions that keeps the hand in one place as long as it
// can (a hand covers four frets), shifts rarely and by as little as possible, welcomes open strings
// and slightly prefers lower positions.
// A note whose string/fret came from the file (tab) is kept when it fits the current tuning.
// Dynamic programming (Viterbi) over every playable position of every note.

/**
 * @param {{midi:number, string?:number|null, fret?:number|null}[]} notes  string = 1 for the top string (MusicXML)
 * @param {number[]} tuning  open strings, low → high
 * @returns {{s:number, f:number}[]}
 */
export function chooseFingering(notes, tuning, frets = 22) {
  const S = tuning.length;
  const options = notes.map((n) => {
    if (n.string && n.fret !== null && n.fret !== undefined) {
      const s = S - n.string;
      if (s >= 0 && s < S && tuning[s] + n.fret === n.midi) return [{ s, f: n.fret }];
    }
    const out = [];
    for (let s = 0; s < S; s++) { const f = n.midi - tuning[s]; if (f >= 0 && f <= frets) out.push({ s, f }); }
    return out.length ? out : [{ s: 0, f: Math.max(0, n.midi - tuning[0]) }];
  });
  if (!options.length) return [];

  // States: (position, hand) — the hand is where the first finger sits; it covers four frets
  // (h .. h+3) and open strings need no hand at all. Moving the hand costs; staying in place is free.
  const H = Math.max(1, frets - 3);
  const states = options.map((opts) => {
    const st = [];
    for (const o of opts) {
      if (o.f === 0) for (let h = 1; h <= H; h++) st.push({ o, h });
      else for (let h = Math.max(1, o.f - 3); h <= Math.min(H, o.f); h++) st.push({ o, h });
    }
    return st;
  });
  const node = ({ o, h }) => h * 0.04 + (o.f >= 15 ? 0.4 : 0) + (o.f && o.f - h === 3 ? 0.15 : 0); // low positions, little-finger stretch
  const edge = (a, b) => (a.h === b.h ? 0 : 1 + 0.3 * Math.abs(a.h - b.h)) + 0.06 * Math.abs(a.o.s - b.o.s);

  let cost = states[0].map(node);
  const back = [states[0].map(() => -1)];
  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1], cur = states[i];
    const next = new Array(cur.length), from = new Array(cur.length);
    for (let k = 0; k < cur.length; k++) {
      let best = Infinity, arg = 0;
      for (let j = 0; j < prev.length; j++) { const c = cost[j] + edge(prev[j], cur[k]); if (c < best) { best = c; arg = j; } }
      next[k] = best + node(cur[k]); from[k] = arg;
    }
    cost = next; back.push(from);
  }
  let k = cost.indexOf(Math.min(...cost));
  const out = new Array(states.length);
  for (let i = states.length - 1; i >= 0; i--) { out[i] = states[i][k].o; k = back[i][k]; }
  return out;
}
