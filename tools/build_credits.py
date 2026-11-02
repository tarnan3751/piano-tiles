"""Generate CREDITS.md from songs/manifest.json"""
import json, os, collections
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
m=json.load(open(os.path.join(ROOT,'songs','manifest.json')))
LIC={'Public Domain':'public domain','Public domain':'public domain'}
def lic(s): return s.replace('Creative Commons Attribution-ShareAlike','CC BY-SA').replace('Creative Commons Attribution','CC BY').replace('CC-BY','CC BY').replace('Public domain','Public Domain')
lines=["# Credits and licenses","","All 100 songs in `songs/` are compositions that are in the public domain or released under an open license, and every MIDI file was taken from a source that states the file's license. Attribution for each file is listed below.","",
"Sources:","- **Mutopia Project** (https://www.mutopiaproject.org) — public domain and Creative Commons sheet music typeset in LilyPond; the MIDI files are generated from those scores. Typesetters are credited per piece.","- **Wikimedia Commons** (https://commons.wikimedia.org) — MIDI files whose uploaders released them as public domain.","- **OpenGameArt.org** (https://opengameart.org) — contemporary music released under CC0, CC BY, CC BY-SA or OGA-BY by their authors.","- **OpenEWLD** (https://github.com/00sapo/OpenEWLD) — public-domain lead sheets (melody and chord symbols) from the old Wikifonia archive, MIT-licensed dataset. The blues songs were rendered from these sheets by `tools/leadsheet2midi.py`, which adds a swung piano, bass and drum backing; that arrangement is released under CC0.","",
"License texts: CC0 https://creativecommons.org/publicdomain/zero/1.0/ · CC BY 2.5/3.0/4.0 https://creativecommons.org/licenses/by/4.0/ · CC BY-SA 2.5/3.0/4.0 https://creativecommons.org/licenses/by-sa/4.0/ · OGA-BY 4.0 https://static.opengameart.org/OGA-BY-4.0.txt","",
"CC BY-SA files are redistributed unmodified under their original license; the license applies to those MIDI files, not to the game code.",""]
by=collections.defaultdict(list)
for s in m['songs']: by[s['source']].append(s)
for src in ["Mutopia Project","Wikimedia Commons","OpenGameArt.org","OpenEWLD (public-domain lead sheets)"]:
    lines.append(f"## {src}"); lines.append("")
    lines.append("| File | Title | Composer / author | Year | Genre | License | Typesetter / credit | Source page |"); lines.append("|---|---|---|---|---|---|---|---|")
    for s in sorted(by[src],key=lambda s:s['title']):
        cred=s.get('typesetter') or (s['composer'] if src=='OpenGameArt.org' else '')
        ed=s.get('edition','')
        lines.append(f"| `{os.path.basename(s['file'])}` | {s['title']} | {s['composer']} | {s['year'] or ''} | {s['genre']} | {lic(s['license'])} | {cred}{(' (' + ed + ')') if ed else ''} | {s['sourceUrl']} |")
    lines.append("")
lines+=["## Code","","Game code in this repository: MIT. three.js (https://threejs.org) is MIT licensed and loaded from a CDN.",""]
open(os.path.join(ROOT,'CREDITS.md'),'w').write("\n".join(lines))
print("CREDITS.md written", len(m['songs']), "songs")
