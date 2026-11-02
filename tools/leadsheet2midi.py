"""Render a public-domain lead sheet (MusicXML, melody + chord symbols) to a MIDI file with a swung blues backing band.
Usage: leadsheet2midi.py in.mxl out.mid [bpm]"""
import sys, math
from music21 import converter, note, chord, harmony, tempo, meter
import mido

SWING = 0.66   # off-beat eighths land here within the beat (0.5 = straight)
def swing_q(q):
    b = math.floor(q + 1e-6); f = q - b
    if abs(f - 0.5) < 0.02: f = SWING
    return b + f

def render(src, dst, bpm_default=96):
    s = converter.parse(src)
    try: s = s.expandRepeats()
    except Exception: pass
    part = s.parts[0] if s.parts else s
    flat = part.flatten()
    # tempo
    bpm = bpm_default
    for mm in flat.getElementsByClass(tempo.MetronomeMark):
        if mm.number: bpm = float(mm.number); break
    ts = flat.getElementsByClass(meter.TimeSignature)
    beats_per_bar = ts[0].beatCount if ts else 4
    # melody
    mel = []
    for el in flat.notes:
        if isinstance(el, harmony.ChordSymbol): continue
        if isinstance(el, chord.Chord): p = max(el.pitches, key=lambda x: x.midi)
        elif isinstance(el, note.Note): p = el.pitch
        else: continue
        if el.tie is not None and el.tie.type in ('stop', 'continue'):
            # extend previous note instead of re-striking
            if mel and mel[-1][2] == p.midi: mel[-1] = (mel[-1][0], mel[-1][1] + float(el.quarterLength), mel[-1][2]); continue
        mel.append((float(el.offset), float(el.quarterLength), p.midi))
    # chords
    chords = []
    for cs in flat.getElementsByClass(harmony.ChordSymbol):
        try: pitches = [p.midi for p in cs.pitches]
        except Exception: pitches = []
        if not pitches: continue
        chords.append([float(cs.offset), None, pitches, cs.root().midi if cs.root() else pitches[0]])
    chords.sort(key=lambda c: c[0])
    total = max([m[0] + m[1] for m in mel] + [c[0] + 4 for c in chords] + [0])
    total_bars = math.ceil(total / beats_per_bar) * beats_per_bar
    for i, c in enumerate(chords): c[1] = (chords[i + 1][0] if i + 1 < len(chords) else total_bars) - c[0]
    if not chords: chords = [[0.0, total_bars, [60, 64, 67, 70], 48]]
    # chord before the first symbol (pickup) -> repeat first chord
    if chords[0][0] > 0: chords.insert(0, [0.0, chords[0][0], chords[0][2], chords[0][3]])

    TPB = 480
    mf = mido.MidiFile(ticks_per_beat=TPB)
    def tick(q): return int(round(swing_q(q) * TPB))
    def track(name, program=None, channel=0):
        tr = mido.MidiTrack(); tr.append(mido.MetaMessage('track_name', name=name, time=0))
        if program is not None: tr.append(mido.Message('program_change', program=program, channel=channel, time=0))
        mf.tracks.append(tr); return tr
    def write_events(tr, events, channel):
        # events: (tick, kind, note, vel)
        events.sort(key=lambda e: (e[0], 0 if e[1] == 'off' else 1))
        t = 0
        for et, kind, n, v in events:
            tr.append(mido.Message('note_on' if kind == 'on' else 'note_off', note=n, velocity=v if kind == 'on' else 0, channel=channel, time=max(0, et - t))); t = et
        tr.append(mido.MetaMessage('end_of_track', time=0))
    meta = track('meta'); meta.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(bpm), time=0)); meta.append(mido.MetaMessage('end_of_track', time=0))
    # melody (trumpet)
    ev = []
    for off, ql, n in mel:
        a, b = tick(off), tick(off + ql) - 8
        ev += [(a, 'on', n, 100), (max(a + 20, b), 'off', n, 0)]
    write_events(track('Melody', 56, 0), ev, 0)
    # piano comping: chord on beats 1 and 3 (short), pushed chord on the "and" of 2 and 4 (swung)
    ev = []
    for off, dur, pitches, root in chords:
        voicing = sorted(set((p - 12 if p > 72 else p + 12 if p < 55 else p) for p in pitches))[:4]
        beat = math.floor(off); end = off + dur
        while beat < end - 1e-6:
            pos = beat - math.floor(beat / beats_per_bar) * beats_per_bar
            hits = [(beat, 0.55, 78)] if pos % 2 == 0 else [(beat + 0.5, 0.4, 62)]
            for (st, ln, vel) in hits:
                if st >= end: continue
                a, b = tick(st), tick(min(st + ln, end)) - 6
                for p in voicing: ev += [(a, 'on', p, vel), (max(a + 20, b), 'off', p, 0)]
            beat += 1
    write_events(track('Piano', 0, 1), ev, 1)
    # walking bass: root, third, fifth, sixth/seventh per bar (or per chord when chords change faster)
    ev = []
    for off, dur, pitches, root in chords:
        r = root - 24 if root >= 60 else root - 12
        while r < 36: r += 12
        while r > 50: r -= 12
        third = 3 if any((p - root) % 12 == 3 for p in pitches) else 4
        seventh = 10 if any((p - root) % 12 == 10 for p in pitches) else 9
        pattern = [0, third, 7, seventh]
        beat = math.floor(off); k = 0; end = off + dur
        while beat < end - 1e-6:
            n = r + pattern[k % 4]; a, b = tick(beat), tick(beat + 0.95)
            ev += [(a, 'on', n, 92), (b, 'off', n, 0)]; beat += 1; k += 1
    write_events(track('Bass', 32, 2), ev, 2)
    # drums: ride every beat + swung skip note, hi-hat 2 & 4, kick 1 & 3, light snare 2 & 4
    ev = []
    beat = 0
    while beat < total_bars:
        pos = beat % beats_per_bar
        ev += [(tick(beat), 'on', 51, 84), (tick(beat) + 60, 'off', 51, 0)]
        ev += [(tick(beat + 0.5), 'on', 51, 60), (tick(beat + 0.5) + 60, 'off', 51, 0)]
        if pos % 2 == 1: ev += [(tick(beat), 'on', 42, 70), (tick(beat) + 40, 'off', 42, 0), (tick(beat), 'on', 38, 58), (tick(beat) + 40, 'off', 38, 0)]
        else: ev += [(tick(beat), 'on', 36, 88), (tick(beat) + 40, 'off', 36, 0)]
        beat += 1
    write_events(track('Drums', None, 9), ev, 9)
    mf.save(dst)
    return dict(bpm=bpm, bars=total_bars / beats_per_bar, melody_notes=len(mel), chords=len(chords), seconds=round(mf.length, 1))

if __name__ == '__main__':
    print(render(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 96))
