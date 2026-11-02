import { AudioEngine } from './audio.js';
import { Scene } from './scene.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { rankMelodyTracks, parseMidi } from './midi.js';

const canvas = document.getElementById('c');
const audio = new AudioEngine();
const scene = new Scene(canvas);
let game, ui, current = null;

async function play(entry, buffer) {
  try {
    ui.showLoading(true, `Loading ${entry.title}…`);
    audio.init(); await audio.resume();
    if (buffer) game.loadBuffer(buffer, entry); else await game.loadEntry(entry);
    current = { entry, buffer };
    ui.showLoading(false); game.start();
  } catch (e) { console.error(e); ui.showLoading(false); ui.toast('Could not load this song: ' + e.message); }
}

ui = new UI(document.getElementById('ui'), {
  onPlay: (s) => play(s),
  onPause: () => game.pause(),
  onResume: () => game.resume(),
  onQuit: () => { game.stop(); ui.showMenu(); },
  onRetry: () => { if (current) play(current.entry, current.buffer); },
});
game = new Game({ scene, audio, ui });

fetch('songs/manifest.json').then(r => r.json()).then(m => {
    ui.setSongs(m.songs); ui.showMenu();
    // Debug helpers: ?play=<song id> auto-starts a song; &bot=1 plays it perfectly (used for automated screenshots).
    const q = new URLSearchParams(location.search);
    if (q.get('debug') || q.get('bot')) window.__game = game;
    if (q.get('play')) { const s = m.songs.find(x => x.id === q.get('play')) || m.songs[0]; play(s).then(() => { if (q.get('bot')) { game.bot = true; game.botMiss = parseFloat(q.get('miss') || '0') || 0; game.botDrop = parseFloat(q.get('drop') || '0') || 0; } }); }
  })
  .catch(e => { console.error(e); ui.toast('Could not load songs/manifest.json. Serve this folder over HTTP (see README).', 8000); });

window.addEventListener('resize', () => scene.resize());
// Drag and drop any MIDI file.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; ui.showDrop(true); });
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('dragleave', (e) => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ui.showDrop(false); });
window.addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; ui.showDrop(false);
  const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
  try {
    const buf = await f.arrayBuffer(); const midi = parseMidi(buf); const ranked = rankMelodyTracks(midi);
    const entry = { id: 'drop-' + Date.now(), title: f.name.replace(/\.midi?$/i, ''), composer: 'Your file', genre: 'Custom', license: 'Your file', duration: midi.duration, difficulty: 3, melodyTracks: ranked.length ? [ranked[0].track] : [0] };
    if (game.state === 'playing' || game.state === 'paused') game.stop();
    play(entry, buf);
  } catch (err) { console.error(err); ui.toast('That file could not be read as MIDI: ' + err.message); }
});
// Keep audio alive on first user gesture (autoplay policies).
window.addEventListener('pointerdown', () => { audio.init(); audio.resume(); }, { once: true });
