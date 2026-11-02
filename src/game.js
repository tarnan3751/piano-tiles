// Game loop, input, timing judgement, scoring, energy, hold notes.
import { parseMidi } from './midi.js';
import { buildChart } from './chart.js';
import { BackingScheduler } from './audio.js';
import { LANES } from './scene.js';

const PERFECT = 0.075, GOOD = 0.165, MISS_AFTER = 0.19;
const RELEASE_TOL = 0.14;   // letting go this early still completes a hold
const LEAD_IN = 1.6;

export class Game {
  constructor({ scene, audio, ui }) {
    this.scene = scene; this.audio = audio; this.ui = ui;
    this.sched = new BackingScheduler(audio);
    this.state = 'idle'; this.chart = null; this.entry = null; this.midi = null;
    this.keyMap = { d: 0, f: 1, j: 2, k: 3, a: 0, s: 1, l: 3, ';': 3, '1': 0, '2': 1, '3': 2, '4': 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
    this.holding = [null, null, null, null]; this.keysDown = new Map(); this.pointerLanes = new Map();
    this.last = performance.now();
    this._bindInput();
    this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
  }
  async loadEntry(entry) {
    const res = await fetch(entry.file); if (!res.ok) throw new Error('Could not load ' + entry.file);
    const buf = await res.arrayBuffer(); return this.loadBuffer(buf, entry);
  }
  loadBuffer(buf, entry) {
    const midi = parseMidi(buf); const chart = buildChart(midi, entry);
    this.midi = midi; this.chart = chart; this.entry = entry; return chart;
  }
  start() {
    if (!this.chart) return;
    this.audio.init(); this.audio.resume();
    // chart-local tiles: times relative to the song start offset, whole song, played once
    const all = [];
    for (const t of this.chart.tiles) { const lt = t.t - this.chart.start; if (lt < 0) continue; all.push({ ...t, t: lt, holdEnd: lt + (t.hold || 0), state: 0, hitAt: 0, voice: null }); }
    this.tiles = all; this.tileStart = 0; this.nextMissIdx = 0; this.holding = [null, null, null, null];
    this.sched.reset(this.chart);
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.health = 100; this.energy = 0.12; this.hits = { perfect: 0, good: 0, miss: 0, empty: 0, holds: 0, dropped: 0 };
    this.total = all.length; this.songStart = this.audio.now + LEAD_IN; this.state = 'playing'; this.ended = false;
    this.scene.setEnergy(this.energy);
    this.ui.showHud(this.entry, this);
  }
  get songTime() { return this.audio.now - this.songStart; }
  get progress() { return this.chart ? Math.max(0, Math.min(1, this.songTime / this.chart.totalLen)) : 0; }
  get speed() { const base = 8.5; return base * (1 + 0.45 * this.progress) * (this.entry?.difficulty >= 5 ? 1.15 : 1); }
  get mult() { return 1 + Math.min(3, this.combo / 25); }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.audio.ctx.suspend(); this.ui.showPaused(true); }
  resume() { if (this.state !== 'paused') return; this.audio.ctx.resume().then(() => { this.state = 'playing'; this.ui.showPaused(false); }); }
  stop() {
    this.state = 'idle'; if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
    for (const t of this.holding) if (t && t.voice) t.voice.release();
    this.holding = [null, null, null, null]; this.tiles = null; this.sched.reset(null);
  }
  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); return; }
      const lane = this.keyMap[e.key]; if (lane == null) return; e.preventDefault();
      this.keysDown.set(e.key, lane); this.press(lane);
    });
    window.addEventListener('keyup', (e) => {
      const lane = this.keyMap[e.key]; if (lane == null) return; this.keysDown.delete(e.key);
      for (const l of this.keysDown.values()) if (l === lane) return; // another key still holds this lane
      this.release(lane);
    });
    window.addEventListener('blur', () => { for (let l = 0; l < LANES; l++) this.release(l); this.keysDown.clear(); this.pointerLanes.clear(); });
    const canvas = this.scene.canvas;
    const laneFromEvent = (ev) => { const r = canvas.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width; return Math.max(0, Math.min(LANES - 1, Math.floor(x * LANES))); };
    canvas.addEventListener('pointerdown', (ev) => {
      if (this.state !== 'playing') return; ev.preventDefault();
      const lane = laneFromEvent(ev); this.pointerLanes.set(ev.pointerId, lane);
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      this.press(lane);
    }, { passive: false });
    const up = (ev) => { const lane = this.pointerLanes.get(ev.pointerId); if (lane == null) return; this.pointerLanes.delete(ev.pointerId); for (const l of this.pointerLanes.values()) if (l === lane) return; this.release(lane); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  press(lane) {
    if (this.state !== 'playing') return;
    const now = this.songTime; this.scene.press(lane);
    let best = null, bestDt = Infinity;
    for (let i = this.tileStart; i < this.tiles.length; i++) {
      const t = this.tiles[i]; if (t.t - now > GOOD) break;
      if (t.state !== 0 || t.lane !== lane) continue;
      const dt = Math.abs(t.t - now); if (dt <= GOOD && dt < bestDt) { best = t; bestDt = dt; }
    }
    if (!best) { // empty tap
      this.hits.empty++; this.combo = 0; this.health = Math.max(0, this.health - 3); this.energy = Math.max(0, this.energy - 0.08);
      this.audio.playMiss(); this.scene.miss(lane); this.ui.flash('empty'); return;
    }
    const perfect = bestDt <= PERFECT; const acc = perfect ? 1 : 1 - (bestDt - PERFECT) / (GOOD - PERFECT) * 0.6;
    const vel = 0.75 + 0.25 * (best.v || 0.8);
    this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (perfect) this.hits.perfect++; else this.hits.good++;
    this.score += Math.round((perfect ? 100 : 60) * this.mult);
    this.health = Math.min(100, this.health + 1.5);
    this.energy = Math.min(1, this.energy + (perfect ? 0.045 : 0.025));
    this.scene.hit(lane, perfect ? 2 : 1, best.hue, best.n);
    this.ui.flash(perfect ? 'perfect' : 'good', this.combo);
    if (best.hold) {   // head of a hold: sustain the note and keep the pill alive until release
      best.state = 3; best.voice = this.audio.playLead(best.n, 0, best.hold + 0.25, acc, vel);
      if (this.holding[lane]) this._completeHold(this.holding[lane]);
      this.holding[lane] = best;
    } else {
      best.state = 1; best.hitAt = this.scene.time;
      this.audio.playLead(best.n, 0, best.d, acc, vel);
    }
  }
  release(lane) {
    const t = this.holding[lane]; if (!t || this.state !== 'playing') return;
    this.holding[lane] = null;
    if (this.songTime >= t.holdEnd - RELEASE_TOL) this._completeHold(t); else this._breakHold(t);
  }
  _completeHold(t) {
    if (t.state !== 3) return;
    t.state = 1; t.hitAt = this.scene.time;
    const bonus = Math.min(400, Math.round(70 * t.hold * this.mult));
    this.score += bonus; this.hits.holds++; this.health = Math.min(100, this.health + 2); this.energy = Math.min(1, this.energy + 0.04);
    this.scene.holdDone(t.lane, t.hue); this.ui.flash('hold', this.combo);
  }
  _breakHold(t) {
    if (t.state !== 3) return;
    t.state = 2; t.missAt = this.scene.time; if (t.voice) t.voice.release();
    this.hits.dropped++; this.combo = 0; this.health = Math.max(0, this.health - 6); this.energy = Math.max(0, this.energy - 0.12);
    this.scene.miss(t.lane, true, t.hue); this.ui.flash('miss');
    if (this.health <= 0) this._end(false);
  }
  _miss(t) {
    t.state = 2; t.missAt = this.scene.time; this.hits.miss++; this.combo = 0; this.health = Math.max(0, this.health - 11); this.energy = Math.max(0, this.energy - 0.22);
    this.scene.miss(t.lane, true, t.hue); this.ui.flash('miss');
    if (this.health <= 0) this._end(false);
  }
  _end(cleared) {
    if (this.ended) return; this.ended = true; this.state = 'results';
    for (const t of this.holding) if (t && t.voice) t.voice.release();
    this.holding = [null, null, null, null];
    const judged = this.hits.perfect + this.hits.good + this.hits.miss + this.hits.dropped;
    const acc = judged ? (this.hits.perfect + this.hits.good * 0.6) / judged : 0;
    this.sched.reset(null);
    this.ui.showResults({ cleared, score: this.score, maxCombo: this.maxCombo, accuracy: acc, total: this.total, ...this.hits, entry: this.entry });
  }
  loop(ts) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (ts - this.last) / 1000); this.last = ts;
    if (this.state === 'playing') {
      const now = this.songTime;
      this.sched.tick(now, this.audio.now);
      if (this.bot) { if (!this._dbg || ts - this._dbg > 2000) { this._dbg = ts; console.log(`BOT state=${this.state} ctx=${this.audio.ctx.state} audioNow=${this.audio.now.toFixed(2)} songTime=${now.toFixed(2)} score=${this.score} combo=${this.combo} health=${this.health.toFixed(0)} energy=${this.energy.toFixed(2)} tiles=${this.tiles.length} holds=${this.hits.holds}`); }
        for (let i = this.tileStart; i < this.tiles.length; i++) { const t = this.tiles[i]; if (t.t > now + 0.02) break; if (t.state === 0 && Math.abs(t.t - now) <= 0.15) { if (this.botMiss && !t.botSkip && Math.random() < this.botMiss) t.botSkip = true; if (!t.botSkip) this.press(t.lane); } } }
      // misses (heads that were never pressed)
      while (this.nextMissIdx < this.tiles.length) {
        const t = this.tiles[this.nextMissIdx]; if (t.t > now - MISS_AFTER) break;
        if (t.state === 0) this._miss(t); this.nextMissIdx++;
      }
      // active holds: stream sparks, complete automatically once the pill has fully passed
      for (let l = 0; l < LANES; l++) {
        const t = this.holding[l]; if (!t) continue;
        if (now >= t.holdEnd) { this.holding[l] = null; this._completeHold(t); }
        else if (this.bot && this.botDrop && t.botDrop === undefined && (t.botDrop = Math.random() < this.botDrop) && now > t.t + t.hold * 0.4) { this.release(l); }
        else if (this.bot && t.botDrop && now > t.t + t.hold * 0.4) { this.release(l); }
        else { this.scene.holdTick(l, t.hue, dt); this.energy = Math.min(1, this.energy + dt * 0.03); }
      }
      while (this.tileStart < this.tiles.length && this.tiles[this.tileStart].t < now - 2 && this.tiles[this.tileStart].state !== 3) this.tileStart++;
      // energy slowly settles toward combo level
      const target = Math.min(1, 0.12 + this.combo / 30); this.energy += (target - this.energy) * Math.min(1, dt * 0.6);
      this.scene.setEnergy(this.energy); this.audio.setEnergy(this.energy);
      this.scene.setSpectrum(this.audio.spectrum());
      this.scene.update(dt, now, this.speed, this.tiles, this.tileStart);
      this.ui.updateHud(this);
      if (now > this.chart.totalLen + 1.2 && !this.ended) this._end(true);
    } else if (this.state === 'paused') {
      this.scene.update(0, this.songTime, this.speed, this.tiles, this.tileStart);
    } else {
      this.idleT = (this.idleT || 0) + dt; this.scene.setEnergy(0.25 + 0.15 * Math.sin(this.idleT * 0.4));
      if (this.audio.ready) this.scene.setSpectrum(this.audio.spectrum());
      this.scene.update(dt, this.idleT * 0.8, 4, null, 0);
    }
    this.scene.render();
  }
}
