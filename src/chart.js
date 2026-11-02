// Builds a playable chart from a parsed MIDI + manifest entry.
// Chart: { tiles:[{t, n, d, lane, hue, hold}], backing:[{t,d,n,v,ch,program,trackIndex}], start, end, totalLen }
// Every song plays once and in full: nothing is looped or clipped.
import { rankMelodyTracks } from './midi.js';

export const LANES = 4;
const MIN_GAP = 0.09;      // seconds between consecutive tiles (thins dense tremolo passages)
const CHORD_WINDOW = 0.035; // notes within this window are one tile (top note wins)
const HOLD_MIN = 0.5;       // notes at least this long become hold notes
const HOLD_MIN_KEPT = 0.35; // a hold shortened below this (by the next note in its lane) becomes a tap

const GAP_MIN = 4.0;   // seconds of melody silence before another track is borrowed
const GAP_PAD = 1.2;   // keep this much clearance from the real melody on either side of the gap

function fillGaps(mel, midi, melSet) {
  if (mel.length < 2) return mel;
  const ranked = rankMelodyTracks(midi).filter(c => !melSet.has(c.track));
  const cands = ranked.filter(c => c.score >= (ranked[0]?.score ?? 0) - 4.5 && c.density >= 0.5).slice(0, 8)
    .map(c => midi.tracks[c.track]).filter(tr => tr && tr.notes.length && tr.notes.reduce((a, n) => a + n.n, 0) / tr.notes.length >= 45);
  if (!cands.length) return mel;
  const extra = [];
  const gaps = [];
  let lastEnd = mel[0].t + mel[0].d;
  for (let i = 1; i < mel.length; i++) { const n = mel[i]; if (n.t - lastEnd >= GAP_MIN) gaps.push([lastEnd + GAP_PAD, n.t - GAP_PAD]); lastEnd = Math.max(lastEnd, n.t + n.d); }
  // also the lead-in before the first melody note and the tail after the last one
  if (mel[0].t >= GAP_MIN) gaps.unshift([0, mel[0].t - GAP_PAD]);
  if (midi.duration - lastEnd >= GAP_MIN) gaps.push([lastEnd + GAP_PAD, midi.duration]);
  for (const [g0, g1] of gaps) {
    if (g1 - g0 < 1.5) continue;
    let best = null, bestCount = Math.max(3, (g1 - g0) * 0.4); // a borrowed track must carry at least ~one note per 2.5 s of the gap
    for (const tr of cands) { const c = tr.notes.reduce((a, n) => a + (n.t >= g0 && n.t < g1 && n.ch !== 9 ? 1 : 0), 0); if (c > bestCount) { best = tr; bestCount = c; } }
    if (best) for (const n of best.notes) if (n.t >= g0 && n.t < g1 && n.ch !== 9) extra.push(n);
  }
  if (!extra.length) return mel;
  return mel.concat(extra).sort((a, b) => a.t - b.t || b.n - a.n);
}

export function buildChart(midi, entry = {}) {
  let melodyTracks = entry.melodyTracks;
  if (!melodyTracks || !melodyTracks.length) {
    const ranked = rankMelodyTracks(midi);
    melodyTracks = ranked.length ? [ranked[0].track] : [0];
  }
  const melSet = new Set(melodyTracks);
  // melody notes: skyline (top note per onset window)
  let mel = [];
  for (const ti of melodyTracks) { const tr = midi.tracks[ti]; if (tr) for (const n of tr.notes) if (n.ch !== 9) mel.push(n); }
  mel.sort((a, b) => a.t - b.t || b.n - a.n);
  // gap filling: where the melody instrument rests for a long stretch, borrow the next-best melodic track so the chart stays continuous
  mel = fillGaps(mel, midi, melSet);
  const tiles = [];
  for (const n of mel) {
    const last = tiles[tiles.length - 1];
    if (last && n.t - last.t < CHORD_WINDOW) { if (n.n > last.n) { last.n = n.n; } last.chord = (last.chord || 1) + 1; continue; }
    if (last && n.t - last.t < MIN_GAP) continue; // thin extreme density
    tiles.push({ t: n.t, n: n.n, d: n.d, v: n.v });
  }
  if (!tiles.length) throw new Error('No melody notes found');
  // lanes from pitch quantiles, with a nudge so repeated pitches don't pin one lane forever
  const pitches = tiles.map(t => t.n).sort((a, b) => a - b);
  const q = (f) => pitches[Math.min(pitches.length - 1, Math.floor(f * pitches.length))];
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const lo = pitches[0], hi = pitches[pitches.length - 1];
  let prevLane = -1, run = 0;
  for (const tile of tiles) {
    let lane = tile.n <= cuts[0] ? 0 : tile.n <= cuts[1] ? 1 : tile.n <= cuts[2] ? 2 : 3;
    if (lane === prevLane) { run++; if (run >= 3) { lane = (lane + (tile.n % 2 ? 1 : 3)) % LANES; run = 0; } } else run = 0;
    prevLane = lane; tile.lane = lane;
    tile.hue = hi > lo ? (tile.n - lo) / (hi - lo) : 0.5; // 0 = lowest pitch, 1 = highest
  }
  // hold notes: long notes become holds, clamped so a hold ends before the next note in the same lane
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]; t.hold = 0;
    if (t.d < HOLD_MIN) continue;
    let end = t.t + t.d;
    for (let j = i + 1; j < tiles.length; j++) { if (tiles[j].t - t.t > t.d) break; if (tiles[j].lane === t.lane) { end = Math.min(end, tiles[j].t - 0.15); break; } }
    const hold = end - t.t; if (hold >= HOLD_MIN_KEPT) t.hold = hold;
  }
  // backing: everything not in melody tracks (melody is played by the player)
  const backing = [];
  for (const tr of midi.tracks) {
    if (melSet.has(tr.index)) continue;
    for (const n of tr.notes) backing.push({ ...n, program: tr.program ?? 0, trackIndex: tr.index });
  }
  backing.sort((a, b) => a.t - b.t);
  // start: skip leading silence before the first melody note (keeps a short lead-in); end: the whole file
  const start = entry.startOffset != null ? entry.startOffset : Math.max(0, tiles[0].t - 1.5);
  const end = midi.duration;
  const totalLen = end - start;
  return { tiles, backing, start, end, totalLen, melodyTracks };
}
