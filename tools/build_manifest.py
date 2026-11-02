"""Build songs/manifest.json from manifest_classical.json + manifest_oga.json.
Adds melody track choice, duration, bpm, difficulty and popularity.
Requires: pip install mido   (run from the project root)"""
import json, os, sys, math, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from melody import analyze, split_tracks
import mido
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S=os.path.join(ROOT,'songs')
# Manual melody-track overrides (track indices in the MIDI file), chosen after inspecting instrument/track names.
OVERRIDES={  "bach-goldberg-aria": [   1  ],  "beethoven-pathetique-adagio": [   1  ],  "bizet-carmen-prelude": [   1  ],  "schubert-ave-maria": [   1  ],  "schubert-impromptu-op90-3": [   1  ],  "dvorak-new-world-largo": [   2  ],  "mozart-queen-of-the-night": [   9  ],  "pierpont-jingle-bells": [   1  ],  "liliuokalani-aloha-oe": [   5,   1  ],  "oga-prepare-your-swords": [   0  ],  "oga-night-of-the-streets-horrorsuspense": [   2  ],  "oga-it-is": [   21,   16,   17  ],  "oga-leap-8bit": [   3,   4,   1  ],  "oga-elevate-instrument-tracks": [   2,   3  ],  "oga-orien2": [   1,   2,   4  ],  "oga-theme-song-8-bit": [   3,   4,   13,   14  ],  "oga-long-away-home-8bit": [   5,   6,   11  ],  "oga-maximum-overdrive": [   2,   5  ],  "oga-headscratcher": [   2,   5,   7  ],  "oga-endless-pain-of-nightmares": [   9,   10,   8  ],  "debussy-arabesque-2": [   1  ],  "trad-swedish-folk-dance-1": [   1  ],  "haydn-emperors-hymn": [   1  ],  "purcell-cold-song": [   1  ],  "oga-rpg-overworld-melodies-of-the-future": [   0  ],  "oga-mechanical-golem": [   2  ] }
WIKI={"bach-prelude-c-major-bwv846":"Prelude and Fugue in C major, BWV 846","bach-invention-1":"Inventions and Sinfonias (Bach)","bach-toccata-fugue-d-minor":"Toccata and Fugue in D minor, BWV 565",
"bach-air-on-the-g-string":"Air on the G String","bach-bourree-e-minor":"Bourrée in E minor","bach-cello-suite-1-prelude":"Cello Suites (Bach)","bach-minuet-in-g":"Minuet in G major, BWV Anh. 114",
"bach-goldberg-aria":"Goldberg Variations","pachelbel-canon-in-d":"Pachelbel's Canon","vivaldi-spring":"The Four Seasons (Vivaldi)","handel-hallelujah":"Messiah (Handel)","beethoven-fur-elise":"Für Elise",
"beethoven-moonlight-sonata":"Piano Sonata No. 14 (Beethoven)","beethoven-pathetique-adagio":"Piano Sonata No. 8 (Beethoven)","beethoven-ode-to-joy":"Ode to Joy","beethoven-symphony-5":"Symphony No. 5 (Beethoven)",
"mozart-rondo-alla-turca":"Piano Sonata No. 11 (Mozart)","mozart-sonata-facile":"Piano Sonata No. 16 (Mozart)","mozart-eine-kleine-nachtmusik":"Eine kleine Nachtmusik","mozart-queen-of-the-night":"Der Hölle Rache kocht in meinem Herzen",
"clementi-sonatina-op36-1":"Clementi","chopin-nocturne-op9-2":"Nocturnes, Op. 9 (Chopin)","chopin-fantaisie-impromptu":"Fantaisie-Impromptu","chopin-raindrop-prelude":"Prelude, Op. 28, No. 15 (Chopin)",
"chopin-revolutionary-etude":"Étude Op. 10, No. 12 (Chopin)","schubert-ave-maria":"Ave Maria (Schubert)","schubert-impromptu-op90-3":"Impromptus (Schubert)","schumann-traumerei":"Kinderszenen","liszt-consolation-3":"Consolations (Liszt)",
"mendelssohn-wedding-march":"Wedding March (Mendelssohn)","brahms-lullaby":"Wiegenlied (Brahms)","grieg-mountain-king":"In the Hall of the Mountain King","dvorak-new-world-largo":"Symphony No. 9 (Dvořák)",
"rachmaninoff-prelude-c-sharp-minor":"Prelude in C-sharp minor (Rachmaninoff)","paganini-caprice-24":"24 Caprices for Solo Violin (Paganini)","mussorgsky-promenade":"Pictures at an Exhibition","debussy-clair-de-lune":"Clair de lune (Debussy)",
"debussy-arabesque-1":"Deux arabesques","satie-gymnopedie-1":"Gymnopédies","satie-gnossienne-1":"Gnossiennes","faure-pavane":"Pavane (Fauré)","joplin-maple-leaf-rag":"Maple Leaf Rag","joplin-the-entertainer":"The Entertainer (rag)",
"joplin-solace":"Solace (Joplin)","joplin-elite-syncopations":"Elite Syncopations","whiting-japanese-sandman":"The Japanese Sandman","tarrega-recuerdos-de-la-alhambra":"Recuerdos de la Alhambra","anon-spanish-romance":"Spanish Romance",
"tarrega-capricho-arabe":"Capricho Árabe","albeniz-rumores-de-la-caleta":"Rumores de la Caleta","trad-greensleeves":"Greensleeves","trad-auld-lang-syne":"Auld Lang Syne","trad-soldiers-joy":"Soldier's Joy","foster-old-folks-at-home":"Old Folks at Home",
"liliuokalani-aloha-oe":"Aloha ʻOe","newton-amazing-grace":"Amazing Grace","bach-o-sacred-head":"O Sacred Head, Now Wounded","trad-veni-emmanuel":"O Come, O Come, Emmanuel","gruber-silent-night":"Silent Night","adam-o-holy-night":"O Holy Night",
"wade-adeste-fideles":"O Come, All Ye Faithful","handel-joy-to-the-world":"Joy to the World","pierpont-jingle-bells":"Jingle Bells","sousa-stars-and-stripes":"The Stars and Stripes Forever","sousa-liberty-bell":"The Liberty Bell (march)",
"schubert-marche-militaire":"Three Marches militaires (Schubert)","key-star-spangled-banner":"The Star-Spangled Banner","rouget-la-marseillaise":"La Marseillaise","verdi-brindisi":"Libiamo ne' lieti calici","schubert-erlkonig":"Erlkönig (Schubert)",
"bizet-carmen-prelude":"Carmen","strauss-blue-danube":"The Blue Danube","bourgeois-old-100th": "Old 100th", "holst-thaxted": "Thaxted (tune)", "trad-st-denio": "Immortal, Invisible, God Only Wise", "trad-lobe-den-herren": "Praise to the Lord, the Almighty", "trad-easter-hymn": "Christ the Lord Is Risen Today", "trad-the-first-noel": "The First Nowell", "trad-good-king-wenceslas": "Good King Wenceslas", "mendelssohn-hark-the-herald": "Hark! The Herald Angels Sing", "brahms-waltz-op39-15": "Sixteen Waltzes, Op. 39 (Brahms)", "chopin-waltz-op69-2": "Waltz in B minor, Op. 69, No. 2 (Chopin)", "mozart-magic-flute-overture": "The Magic Flute", "mozart-deh-vieni-alla-finestra": "Don Giovanni", "purcell-cold-song": "King Arthur (opera)", "bizet-carmen-entracte": "Carmen", "verdi-traviata-prelude": "La traviata", "joplin-the-easy-winners": "The Easy Winners", "joplin-bethena": "Bethena", "turpin-harlem-rag": "Harlem Rag", "tarrega-adelita": "Adelita (mazurka)", "tarrega-lagrima": "L\u00e1grima", "debussy-arabesque-2": "Deux arabesques", "satie-gymnopedie-3": "Gymnop\u00e9dies", "sousa-washington-post": "The Washington Post (march)", "sousa-el-capitan": "El Capitan (march)", "sousa-king-cotton": "King Cotton (march)", "tchaikovsky-wooden-soldiers": "Children's Album (Tchaikovsky)", "trad-mo-li-hua": "Mo Li Hua", "trad-john-barleycorn": "John Barleycorn", "haydn-emperors-hymn": "Gott erhalte Franz den Kaiser", "lavallee-o-canada": "O Canada", "ward-america-the-beautiful": "America the Beautiful", "mccormick-advance-australia-fair": "Advance Australia Fair", "hayashi-kimigayo": "Kimigayo", "creamer-layton-after-youve-gone": "After You've Gone (song)", "thornton-streets-of-cairo": "The Streets of Cairo, or the Poor Little Country Maid", "lincke-berliner-luft": "Berliner Luft"}
views={}
for fn in ('wiki_views.json','wiki_views2.json','wiki_views3.json'):
    p=os.path.join(os.path.dirname(os.path.abspath(__file__)),fn)
    if os.path.exists(p): views.update({k:v for k,v in json.load(open(p)).items() if v})
def first_onset_sec(path, tracks):
    mf=mido.MidiFile(path); tpb=mf.ticks_per_beat
    tempos,strs=split_tracks(mf)
    per=[min((n[0] for n in notes if n[3]!=9),default=None) for _,_,_,notes in strs]
    if not tempos: tempos=[(0,500000)]
    def t2s(tick):
        sec=0; last=0; cur=tempos[0][1]
        for tt,tp in tempos:
            if tt>=tick: break
            sec+=(tt-last)*cur/tpb/1e6; last=tt; cur=tp
        return sec+(tick-last)*cur/tpb/1e6
    firsts=[per[i] for i in tracks if i<len(per) and per[i] is not None]
    return t2s(min(firsts)) if firsts else 0.0, round(60e6/tempos[0][1])
songs=json.load(open(os.path.join(S,'manifest_classical.json')))+json.load(open(os.path.join(S,'manifest_oga.json')))
out=[]
for s in songs:
    path=os.path.join(ROOT,s['file']); a=analyze(path)
    tracks=OVERRIDES.get(s['id']) or [a['best']['track']]
    first,bpm=first_onset_sec(path,tracks)
    dur=a['duration']
    # density of chosen melody tracks (onsets/sec over play span)
    cands={c['track']:c for c in ([a['best']]+a['alts']) if c}
    dens=[cands[t]['density'] for t in tracks if t in cands]
    d=max(dens) if dens else (a['best']['density'] if a['best'] else 1)
    diff=1 if d<1.2 else 2 if d<2.2 else 3 if d<3.5 else 4 if d<5 else 5
    pop=views.get(WIKI.get(s['id'],''),None)
    e=dict(s); e.update({"melodyTracks":tracks,"duration":round(dur,1),"startOffset":round(max(0,first-1.5),2),"bpm":bpm,
                         "melodyDensity":round(d,2),"difficulty":diff,"popularity":pop if pop else (s.get('favorites') and s['favorites']*1000)})
    out.append(e)
json.dump({"generated":"tools/build_manifest.py","count":len(out),"songs":out},open(os.path.join(S,'manifest.json'),'w'),indent=1,ensure_ascii=False)
print(len(out),"songs ->",os.path.join(S,'manifest.json'))
import collections
print(collections.Counter(e['genre'] for e in out))
print("difficulty:",collections.Counter(e['difficulty'] for e in out))
for e in out: print(f"{e['id'][:34]:<34} d{e['difficulty']} {e['duration']:>5.0f}s off{e['startOffset']:>5} mel{e['melodyTracks']} bpm{e['bpm']}")
