# Neon Tiles

A Piano Tiles style rhythm game in three.js. The tiles carry the melody of a real song; tap them in time while the backing track plays, and the neon highway reacts to how well you play.

- 200 songs across 25 genres, all public domain or openly licensed. See `CREDITS.md`.
- Hold notes, a reactive world (fog, bloom, shockwaves, spectrum towers), and drag-and-drop for your own MIDI files.

## Run

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Any static server works; the page needs HTTP because it loads three.js from a CDN and fetches the song files.

## Controls

| Action | Input |
|---|---|
| Lanes | `D` `F` `J` `K`, or tap a lane |
| Hold notes | Keep the key down until the long pill has passed |
| Pause | `Esc` |

## Layout

- `src/` game code: parser, chart builder, synth, scene, game loop, UI
- `songs/` the MIDI files and `manifest.json`
- `tools/` scripts that build the manifest and credits, and the lead-sheet renderer used for the blues songs

Game code is MIT. Song licenses are listed per file in `CREDITS.md`.
