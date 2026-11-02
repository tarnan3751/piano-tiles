// Minimal Standard MIDI File parser (format 0/1). Produces absolute-time notes in seconds.
// Output: { ticksPerBeat, tracks: [{ index, name, program, channels, notes: [{t, d, n, v, ch}] }], tempos, duration }

export function parseMidi(buffer) {
  const data = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let pos = 0;
  const readStr = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[pos + i]); pos += n; return s; };
  const u32 = () => { const v = data.getUint32(pos); pos += 4; return v; };
  const u16 = () => { const v = data.getUint16(pos); pos += 2; return v; };
  const u8 = () => bytes[pos++];
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (readStr(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hdrLen = u32();
  const format = u16();
  const nTracks = u16();
  const division = u16();
  pos += hdrLen - 6;
  if (division & 0x8000) throw new Error('SMPTE time division not supported');
  const tpb = division;

  const tempos = []; // {tick, usPerBeat}
  const tracks = [];
  for (let ti = 0; ti < nTracks; ti++) {
    if (pos >= bytes.length) break;
    if (readStr(4) !== 'MTrk') { break; }
    const len = u32();
    const end = pos + len;
    let tick = 0, running = 0, name = null, program = null;
    const channels = new Set(); const programs = new Map();
    const notes = [];
    const open = new Map(); // key ch:note -> [{tick, v}]
    while (pos < end) {
      tick += vlq();
      let status = u8();
      if (status < 0x80) { pos--; status = running; } else if (status < 0xf0) { running = status; }
      const type = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) {
        const meta = u8(); const l = vlq(); const start = pos;
        if (meta === 0x51) { tempos.push({ tick, usPerBeat: (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2] }); }
        else if (meta === 0x03 && name === null) { name = new TextDecoder('latin1').decode(bytes.subarray(pos, pos + l)); }
        pos = start + l;
      } else if (status === 0xf0 || status === 0xf7) { const l = vlq(); pos += l; }
      else if (type === 0x90 || type === 0x80) {
        const n = u8(), v = u8();
        const key = ch * 128 + n;
        if (type === 0x90 && v > 0) {
          if (!open.has(key)) open.set(key, []);
          open.get(key).push({ tick, v }); channels.add(ch);
        } else {
          const arr = open.get(key);
          if (arr && arr.length) { const s = arr.shift(); notes.push({ st: s.tick, et: tick, n, v: s.v, ch }); }
        }
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) { pos += 2; }
      else if (type === 0xc0) { const p = u8(); if (program === null) program = p; if (!programs.has(ch)) programs.set(ch, p); channels.add(ch); }
      else if (type === 0xd0) { pos += 1; }
      else { /* unknown */ }
    }
    // close dangling notes
    for (const [key, arr] of open) for (const s of arr) notes.push({ st: s.tick, et: tick, n: key % 128, v: s.v, ch: Math.floor(key / 128) });
    pos = end;
    // A track that carries several channels (common in format-0 files) becomes one pseudo-track per channel,
    // so the melody chooser and the backing player can treat each instrument separately.
    const noteChannels = [...new Set(notes.map(n => n.ch))].sort((a, b) => a - b);
    if (noteChannels.length > 1) {
      for (const ch of noteChannels) tracks.push({ index: tracks.length, srcTrack: ti, channel: ch, name: name ? `${name} ch${ch + 1}` : `Track ${ti} ch${ch + 1}`, program: programs.has(ch) ? programs.get(ch) : program, channels: [ch], rawNotes: notes.filter(n => n.ch === ch) });
    } else {
      tracks.push({ index: tracks.length, srcTrack: ti, channel: noteChannels[0] ?? null, name, program, channels: [...channels], rawNotes: notes });
    }
  }
  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length) tempos.push({ tick: 0, usPerBeat: 500000 });
  // tick -> seconds with tempo map
  const segs = []; let sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    const cur = tempos[i], next = tempos[i + 1];
    segs.push({ tick: cur.tick, sec, spt: cur.usPerBeat / tpb / 1e6 });
    if (next) sec += (next.tick - cur.tick) * cur.usPerBeat / tpb / 1e6;
  }
  const tickToSec = (t) => {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].tick <= t) lo = mid; else hi = mid - 1; }
    const s = segs[lo]; return s.sec + (t - s.tick) * s.spt;
  };
  let duration = 0;
  for (const tr of tracks) {
    tr.notes = tr.rawNotes.map(r => { const t = tickToSec(r.st), e = tickToSec(r.et); if (e > duration) duration = e; return { t, d: Math.max(0.03, e - t), n: r.n, v: r.v / 127, ch: r.ch }; })
      .sort((a, b) => a.t - b.t);
    delete tr.rawNotes;
  }
  return { format, ticksPerBeat: tpb, tracks, tempos, duration, bpm: Math.round(60e6 / tempos[0].usPerBeat) };
}

// Heuristic melody-track chooser (port of tools/melody.py). Returns array of track indices (best first).
const GOOD = /lead|melod|vocal|voice|voix|flute|fl[öo]te|solo|main|theme|sax|trumpet|violin|oboe|clarinet|guitar|gitarre|piano|right|\brh\b|soprano|canto|koto|pulse ?1|square ?1/i;
const BAD = /bass|pad|drum|perc|kick|snare|hat|noise|chord|accomp|arp|legato|choir|strings? leg|cello|contra|timpan|triang|left|\blh\b|harmon|rhythm|\bcomp\b|\btri\b|shaker|clap|\btom\b|cymbal|ride|crash|tamb|conga|bongo|written|by |copyright|http|www/i;
export function rankMelodyTracks(midi) {
  const total = midi.duration || 1;
  const scored = [];
  for (const tr of midi.tracks) {
    const ns = tr.notes.filter(n => n.ch !== 9);
    if (ns.length < 12) continue;
    const onsets = new Set(ns.map(n => Math.round(n.t * 100))).size;
    const start = ns[0].t, endT = Math.max(...ns.map(n => n.t + n.d));
    const span = endT - start; if (span <= 0) continue;
    const cov = span / total, d = onsets / span, mono = onsets / ns.length;
    const mp = ns.reduce((a, n) => a + n.n, 0) / ns.length;
    const avgdur = ns.reduce((a, n) => a + n.d, 0) / ns.length;
    const variety = new Set(ns.map(n => n.n)).size / Math.max(onsets, 1);
    let sc = 2 * cov;
    sc += (d >= 1 && d <= 6.5) ? 1 : ((d >= 0.6 && d < 1) || (d > 6.5 && d <= 8)) ? 0.3 : -1;
    sc += mono;
    sc += Math.max(-1.5, Math.min(1, (mp - 56) / 14));
    sc += Math.min(1.4, Math.log(onsets + 1) / 4.2);
    if (onsets < 40) sc -= 2; if (d < 1) sc -= 0.6;
    sc += (avgdur >= 0.05 && avgdur <= 1.5) ? 0.6 : -0.4;
    sc += variety > 0.08 ? 0.5 : -0.8;
    const nm = tr.name || '';
    if (GOOD.test(nm)) sc += 0.8; if (BAD.test(nm)) sc -= 1.2;
    const p = tr.program;
    if (p !== null && p >= 32 && p <= 39) sc -= 1.5;
    if (p !== null && p >= 88 && p <= 95) sc -= 0.8;
    if (p !== null && [72,73,74,75,56,57,64,65,66,67,68,69,70,71,40,41,80,81].includes(p)) sc += 0.5;
    scored.push({ track: tr.index, score: sc, onsets, density: d });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
