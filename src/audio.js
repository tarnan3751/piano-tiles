// Web Audio synth engine: a lead voice for the player's tiles, GM-family backing voices,
// drums, an energy-driven low-pass filter on the backing bus, and an analyser for the visuals.

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

function makeImpulse(ctx, seconds = 2.2, decay = 3.5) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return buf;
}

function family(program) {
  if (program == null) return 'piano';
  if (program < 8) return 'piano'; if (program < 16) return 'chromatic'; if (program < 24) return 'organ';
  if (program < 32) return 'guitar'; if (program < 40) return 'bass'; if (program < 48) return 'strings';
  if (program < 56) return 'ensemble'; if (program < 64) return 'brass'; if (program < 72) return 'reed';
  if (program < 80) return 'pipe'; if (program < 88) return 'lead'; if (program < 96) return 'pad';
  if (program < 104) return 'fx'; if (program < 112) return 'ethnic'; if (program < 120) return 'perc'; return 'fx';
}

export class AudioEngine {
  constructor() {
    this.ctx = null; this.ready = false; this.voices = 0; this.maxBacking = 28;
  }
  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.18;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.78;
    this.master.connect(this.comp); this.comp.connect(this.analyser); this.analyser.connect(ctx.destination);
    // reverb send
    this.reverb = ctx.createConvolver(); this.reverb.buffer = makeImpulse(ctx);
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
    // backing bus with energy filter
    this.backFilter = ctx.createBiquadFilter(); this.backFilter.type = 'lowpass'; this.backFilter.frequency.value = 1200; this.backFilter.Q.value = 0.7;
    this.backBus = ctx.createGain(); this.backBus.gain.value = 0.55;
    this.backBus.connect(this.backFilter); this.backFilter.connect(this.master); this.backFilter.connect(this.reverb);
    // lead bus
    this.leadBus = ctx.createGain(); this.leadBus.gain.value = 0.8;
    this.leadDelay = ctx.createDelay(1.0); this.leadDelay.delayTime.value = 0.28;
    this.leadDelayGain = ctx.createGain(); this.leadDelayGain.gain.value = 0.18;
    this.leadBus.connect(this.master); this.leadBus.connect(this.reverb);
    this.leadBus.connect(this.leadDelay); this.leadDelay.connect(this.leadDelayGain); this.leadDelayGain.connect(this.master); this.leadDelayGain.connect(this.leadDelay);
    this.drumBus = ctx.createGain(); this.drumBus.gain.value = 0.5; this.drumBus.connect(this.master);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.ready = true;
  }
  resume() { if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume(); return Promise.resolve(); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  setEnergy(e) { // 0..1 -> filter cutoff + reverb amount
    if (!this.ctx) return;
    const f = 600 * Math.pow(18000 / 600, Math.min(1, Math.max(0, e)));
    this.backFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
    this.reverbGain.gain.setTargetAtTime(0.16 + 0.16 * e, this.ctx.currentTime, 0.2);
  }
  spectrum() { if (!this.ready) return null; this.analyser.getByteFrequencyData(this.freqData); return this.freqData; }

  // The player's note. accuracy 0..1 scales brightness and velocity.
  playLead(note, when = 0, dur = 0.5, accuracy = 1, vel = 0.9) {
    const ctx = this.ctx; const t = Math.max(ctx.currentTime, when || ctx.currentTime);
    const f = mtof(note); const g = ctx.createGain(); const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 1.2;
    const peak = 1200 + 5200 * accuracy + f * 2;
    filt.frequency.setValueAtTime(peak, t); filt.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), t + 0.35);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = 'triangle'; o2.type = 'sawtooth'; o3.type = 'sine';
    o1.frequency.value = f; o2.frequency.value = f; o2.detune.value = 6; o3.frequency.value = f * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.28; const g3 = ctx.createGain(); g3.gain.value = 0.12;
    o1.connect(filt); o2.connect(g2); g2.connect(filt); o3.connect(g3); g3.connect(filt); filt.connect(g); g.connect(this.leadBus);
    const v = 0.25 * vel * (0.75 + 0.25 * accuracy);
    const hold = Math.min(10, Math.max(0.18, dur));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(v * 0.45, t + 0.25);
    g.gain.setTargetAtTime(0.0001, t + hold, 0.12);
    const stop = t + hold + 0.8;
    o1.start(t); o2.start(t); o3.start(t); o1.stop(stop); o2.stop(stop); o3.stop(stop);
    // handle: release() cuts a held note short
    return { release: () => { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.setTargetAtTime(0.0001, n, 0.04); for (const o of [o1, o2, o3]) { try { o.stop(n + 0.3); } catch (e) {} } } };
  }
  // Backing note by GM family.
  playBacking(n, when, program, ch) {
    if (ch === 9) return this.playDrum(n.n, when, n.v);
    if (this.voices >= this.maxBacking) return;
    const ctx = this.ctx; const t = Math.max(ctx.currentTime, when); const fam = family(program);
    const f = mtof(n.n); const vel = 0.1 + 0.9 * n.v; const g = ctx.createGain(); const out = this.backBus;
    let oscs = [], att = 0.01, rel = 0.25, sus = 0.5, amp = 0.16, dur = Math.min(n.d, 6);
    const mk = (type, mul = 1, det = 0, gain = 1) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul; o.detune.value = det; const og = ctx.createGain(); og.gain.value = gain; o.connect(og); og.connect(g); oscs.push(o); };
    switch (fam) {
      case 'piano': case 'chromatic': mk('triangle', 1, 0, 1); mk('sine', 2, 0, 0.25); mk('sine', 3, 0, 0.08); att = 0.004; sus = 0.18; rel = 0.3; amp = 0.2; dur = Math.min(dur, 2.5); break;
      case 'guitar': case 'ethnic': mk('triangle', 1, 0, 1); mk('sawtooth', 1, 0, 0.12); att = 0.003; sus = 0.12; rel = 0.2; amp = 0.18; dur = Math.min(dur, 1.6); break;
      case 'bass': mk('sine', 1, 0, 1); mk('square', 1, 0, 0.2); att = 0.006; sus = 0.6; rel = 0.12; amp = 0.22; break;
      case 'strings': case 'ensemble': mk('sawtooth', 1, -7, 0.5); mk('sawtooth', 1, 7, 0.5); att = 0.08; sus = 0.8; rel = 0.3; amp = 0.11; break;
      case 'brass': mk('sawtooth', 1, 0, 0.8); mk('square', 1, 4, 0.2); att = 0.03; sus = 0.7; rel = 0.15; amp = 0.12; break;
      case 'reed': case 'pipe': mk('sine', 1, 0, 0.8); mk('triangle', 1, 3, 0.4); att = 0.03; sus = 0.8; rel = 0.12; amp = 0.14; break;
      case 'organ': mk('sine', 1, 0, 0.8); mk('sine', 2, 0, 0.5); mk('sine', 4, 0, 0.25); att = 0.01; sus = 1; rel = 0.08; amp = 0.1; break;
      case 'lead': mk('square', 1, 0, 0.5); mk('sawtooth', 1, 8, 0.5); att = 0.01; sus = 0.7; rel = 0.12; amp = 0.11; break;
      case 'pad': case 'fx': mk('sawtooth', 1, -10, 0.4); mk('sawtooth', 1, 10, 0.4); mk('sine', 0.5, 0, 0.3); att = 0.25; sus = 0.9; rel = 0.6; amp = 0.07; break;
      case 'perc': return this.playDrum(60 + (n.n % 12), when, n.v);
      default: mk('triangle', 1, 0, 1); break;
    }
    const v = amp * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + att);
    g.gain.setTargetAtTime(v * sus, t + att, 0.18);
    g.gain.setTargetAtTime(0.0001, t + Math.max(att + 0.02, dur), rel / 3);
    g.connect(out);
    const stop = t + Math.max(att + 0.02, dur) + rel * 2 + 0.05;
    for (const o of oscs) { o.start(t); o.stop(stop); }
    this.voices++; oscs[0].onended = () => { this.voices--; };
  }
  playDrum(note, when, vel = 0.8) {
    const ctx = this.ctx; const t = Math.max(ctx.currentTime, when); const g = ctx.createGain(); g.connect(this.drumBus);
    const v = 0.5 * (0.3 + 0.7 * vel);
    if (note === 35 || note === 36) { // kick
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(v * 1.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g); o.start(t); o.stop(t + 0.32);
    } else if (note === 38 || note === 40 || note === 37) { // snare
      const s = ctx.createBufferSource(); s.buffer = this.noise; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
      g.gain.setValueAtTime(v * 0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); s.connect(bp); bp.connect(g); s.start(t); s.stop(t + 0.2);
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.08); const og = ctx.createGain(); og.gain.setValueAtTime(v * 0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1); o.connect(og); og.connect(this.drumBus); o.start(t); o.stop(t + 0.12);
    } else if (note === 42 || note === 44 || note === 46 || note === 51 || note === 59) { // hats / ride
      const s = ctx.createBufferSource(); s.buffer = this.noise; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const len = note === 46 ? 0.25 : 0.06; g.gain.setValueAtTime(v * 0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + len); s.connect(hp); hp.connect(g); s.start(t); s.stop(t + len + 0.02);
    } else if (note === 49 || note === 57 || note === 55 || note === 52) { // crash
      const s = ctx.createBufferSource(); s.buffer = this.noise; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
      g.gain.setValueAtTime(v * 0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9); s.connect(hp); hp.connect(g); s.start(t); s.stop(t + 0.95);
    } else { // toms & misc
      const o = ctx.createOscillator(); o.type = 'sine'; const f0 = 90 + (note % 12) * 18; o.frequency.setValueAtTime(f0 * 1.6, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.1);
      g.gain.setValueAtTime(v * 0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); o.start(t); o.stop(t + 0.27);
    }
  }
  // soft tick for empty taps / misses
  playMiss(when = 0) {
    const ctx = this.ctx; const t = Math.max(ctx.currentTime, when); const s = ctx.createBufferSource(); s.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(lp); lp.connect(g); g.connect(this.master); s.start(t); s.stop(t + 0.14);
  }
}

// Schedules backing notes ahead of the song clock (one pass through the whole song).
export class BackingScheduler {
  constructor(engine) { this.engine = engine; this.lookahead = 0.25; this.reset(null); }
  reset(chart) { this.chart = chart; this.idx = 0; }
  // songTime: chart-local time; audioTime: engine.now at that songTime
  tick(songTime, audioTime) {
    const ch = this.chart; if (!ch) return;
    const until = songTime + this.lookahead;
    const notes = ch.backing;
    while (this.idx < notes.length) {
      const n = notes[this.idx];
      const st = n.t - ch.start;
      if (st < 0) { this.idx++; continue; }
      if (st > until) return;
      this.idx++;
      if (st < songTime - 0.05) continue;
      this.engine.playBacking(n, audioTime + (st - songTime), n.program, n.ch);
    }
  }
}
