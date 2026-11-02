"""Pick the most melody-like track in a MIDI file. Usage: melody_pick.py file... -> JSON lines"""
import sys, json, re, math, mido, statistics
GOOD=re.compile(r'lead|melod|vocal|voice|voix|flute|fl[öo]te|solo|main|theme|sax|trumpet|violin|oboe|clarinet|guitar|gitarre|piano|right|rh\b|soprano|canto|koto|pulse ?1|square ?1|2a03 pulse 1',re.I)
BAD=re.compile(r'bass|pad|drum|perc|kick|snare|hat|noise|chord|accomp|arp|legato|choir|strings? leg|cello|contra|timpan|triang|left|lh\b|harmon|rhythm|comp\b|tri\b|triangle|shaker|clap|tom\b|cymbal|ride|crash|tamb|conga|bongo|written|by |copyright|http|www',re.I)
def split_tracks(mf):
    """Returns (tempos, tracks) where tracks = [(index, name, program, notes[(start_tick,end_tick,note,channel)])].
    A MIDI track carrying several channels is split into one entry per channel (same rule as src/midi.js)."""
    tempos=[]; tracks=[]
    for ti,tr in enumerate(mf.tracks):
        t=0; notes=[]; on={}; name=None; prog=None; progs={}
        for msg in tr:
            t+=msg.time
            if msg.type=='set_tempo': tempos.append((t,msg.tempo))
            elif msg.type=='track_name': name=msg.name
            elif msg.type=='program_change':
                if prog is None: prog=msg.program
                progs.setdefault(msg.channel,msg.program)
            elif msg.type=='note_on' and msg.velocity>0: on.setdefault((msg.channel,msg.note),[]).append(t)
            elif msg.type in ('note_off','note_on'):
                k=(msg.channel,msg.note)
                if on.get(k): s=on[k].pop(0); notes.append((s,t,msg.note,msg.channel))
        chans=sorted(set(n[3] for n in notes))
        if len(chans)>1:
            for ch in chans: tracks.append((len(tracks),f"{name} ch{ch+1}" if name else f"Track {ti} ch{ch+1}",progs.get(ch,prog),[n for n in notes if n[3]==ch]))
        else:
            tracks.append((len(tracks),name,prog,notes))
    tempos.sort()
    return tempos,tracks

def analyze(path):
    mf=mido.MidiFile(path); tpb=mf.ticks_per_beat
    tempos,tracks=split_tracks(mf)
    if not tempos: tempos=[(0,500000)]
    def t2s(tick):
        sec=0; last=0; cur=tempos[0][1]
        for tt,tp in tempos:
            if tt>=tick: break
            sec+=(tt-last)*cur/tpb/1e6; last=tt; cur=tp
        return sec+(tick-last)*cur/tpb/1e6
    allend=max((t2s(e) for _,_,_,ns in tracks for s,e,n,c in ns),default=0)
    cands=[]
    for ti,name,prog,ns in tracks:
        ns=[(t2s(s),t2s(e),n) for s,e,n,c in ns if c!=9]
        if len(ns)<12: continue
        onsets=sorted(set(round(s,2) for s,e,n in ns))
        span=max(e for s,e,n in ns)-min(s for s,e,n in ns)
        if span<=0: continue
        cov=span/allend if allend else 0; d=len(onsets)/span; mono=len(onsets)/len(ns)
        mp=statistics.mean(n for s,e,n in ns)
        avgdur=statistics.mean(e-s for s,e,n in ns)
        # pitch variety: distinct pitches / onsets
        var=len(set(n for s,e,n in ns))/max(len(onsets),1)
        sc=2.0*cov
        sc+= 1.0 if 1.0<=d<=6.5 else (0.3 if 0.6<=d<1.0 or 6.5<d<=8 else -1.0)
        sc+= mono*1.0
        sc+= max(-1.5,min(1.0,(mp-56)/14))
        sc+= min(1.4, math.log(len(onsets)+1)/4.2)
        if len(onsets)<40: sc-=2.0
        if d<1.0: sc-=0.6
        sc+= 0.6 if 0.05<=avgdur<=1.5 else -0.4
        sc+= 0.5 if var>0.08 else -0.8
        nm=name or ''
        if GOOD.search(nm): sc+=0.8
        if BAD.search(nm): sc-=1.2
        if prog is not None and (32<=prog<=39): sc-=1.5   # GM bass
        if prog is not None and (88<=prog<=95): sc-=0.8   # pads
        if prog is not None and (prog in (72,73,74,75,56,57,64,65,66,67,68,69,70,71,40,41,80,81)): sc+=0.5 # winds/brass/strings/leads
        cands.append({"avgdur":round(avgdur,2),"track":ti,"name":name,"prog":prog,"onsets":len(onsets),"density":round(d,2),"cov":round(cov,2),"mono":round(mono,2),"mp":round(mp,1),"score":round(sc,2)})
    cands.sort(key=lambda c:-c["score"])
    return {"file":path,"duration":round(allend,1),"best":cands[0] if cands else None,"alts":cands[1:4]}
if __name__=="__main__":
    for p in sys.argv[1:]:
        try: print(json.dumps(analyze(p)))
        except Exception as e: print(json.dumps({"file":p,"error":str(e)[:100]}))
