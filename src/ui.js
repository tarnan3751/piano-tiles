// DOM overlays: song menu, HUD, pause, results, credits, drag-and-drop.
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LIC_SHORT = (l) => (l || '').replace('Creative Commons Attribution-ShareAlike', 'CC BY-SA').replace('Creative Commons Attribution', 'CC BY').replace('Public domain', 'Public Domain').replace('CC-BY', 'CC BY');

export class UI {
  constructor(root, handlers) {
    this.root = root; this.h = handlers; this.songs = []; this.filter = 'All'; this.query = ''; this.sort = 'popular';
    this._build();
  }
  _build() {
    const r = this.root;
    r.innerHTML = `
      <div id="menu" class="panel">
        <div class="title"><h1>NEON<span>TILES</span></h1><p class="tag">200 songs, all public domain or openly licensed.</p></div>
        <div class="controls">
          <input id="search" type="search" placeholder="Search title, composer, genre…" autocomplete="off">
          <select id="sort"><option value="popular">Most popular</option><option value="title">Title A–Z</option><option value="composer">Composer</option><option value="year">Year</option><option value="difficulty">Difficulty</option><option value="duration">Duration</option></select>
        </div>
        <div id="genres" class="chips"></div>
        <div id="list" class="list"></div>
        <div class="footer">The four lanes are <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd>, or tap them. Keep the key held for long notes. <kbd>Esc</kbd> pauses. You can also drag your own <b>.mid</b> file onto the page. <a href="#" id="creditsLink">Credits &amp; licenses</a></div>
      </div>
      <div id="hud" class="hidden">
        <div class="hud-top"><div class="hud-song"><b id="hudTitle"></b><span id="hudComposer"></span></div><div class="hud-score"><div id="hudScore">0</div><div class="hud-sub"><span id="hudAcc">100%</span></div></div></div>
        <div class="hud-combo"><div id="hudCombo"></div><div id="hudJudge"></div></div>
        <div class="hud-bottom"><div class="bar health"><div id="healthFill"></div></div><div class="bar progress"><div id="progFill"></div></div></div>
        <button id="pauseBtn" title="Pause (Esc)">II</button>
      </div>
      <div id="pause" class="panel small hidden"><h2>Paused</h2><div class="btns"><button id="resumeBtn" class="primary">Resume</button><button id="quitBtn">Back to songs</button></div></div>
      <div id="results" class="panel small hidden"><h2 id="resTitle"></h2><p id="resSong"></p><div class="res-grid" id="resGrid"></div><div class="btns"><button id="retryBtn" class="primary">Play again</button><button id="menuBtn">Back to songs</button></div></div>
      <div id="credits" class="panel hidden"><h2>Credits &amp; licenses</h2><p>Every composition is public domain or openly licensed, and every MIDI file comes from a source that states its license. Typesetters and authors are credited below. Full details in <code>CREDITS.md</code>.</p><div id="creditList" class="list credits"></div><div class="btns"><button id="creditsClose" class="primary">Close</button></div></div>
      <div id="loading" class="hidden"><div class="spinner"></div><div id="loadingText">Loading…</div></div>
      <div id="drop" class="hidden">Drop a .mid file to play it</div>
      <div id="toast" class="hidden"></div>`;
    this.$ = (id) => r.querySelector('#' + id);
    this.$('search').addEventListener('input', (e) => { this.query = e.target.value.toLowerCase(); this.renderList(); });
    this.$('sort').addEventListener('change', (e) => { this.sort = e.target.value; this.renderList(); });
    this.$('pauseBtn').addEventListener('click', () => this.h.onPause());
    this.$('resumeBtn').addEventListener('click', () => this.h.onResume());
    this.$('quitBtn').addEventListener('click', () => this.h.onQuit());
    this.$('retryBtn').addEventListener('click', () => this.h.onRetry());
    this.$('menuBtn').addEventListener('click', () => this.h.onQuit());
    this.$('creditsLink').addEventListener('click', (e) => { e.preventDefault(); this.showCredits(); });
    this.$('creditsClose').addEventListener('click', () => this.$('credits').classList.add('hidden'));
  }
  setSongs(songs) {
    this.songs = songs;
    const genres = ['All', ...[...new Set(songs.map(s => s.genre))].sort()];
    const g = this.$('genres'); g.innerHTML = '';
    for (const name of genres) {
      const c = el('button', 'chip' + (name === this.filter ? ' on' : ''), esc(name)); c.dataset.g = name;
      c.addEventListener('click', () => { this.filter = name; g.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.dataset.g === name)); this.renderList(); });
      g.appendChild(c);
    }
    this.renderList();
  }
  renderList() {
    let list = this.songs.filter(s => (this.filter === 'All' || s.genre === this.filter) && (!this.query || `${s.title} ${s.composer} ${s.genre} ${s.year || ''}`.toLowerCase().includes(this.query)));
    const key = { popular: (a, b) => (b.popularity || 0) - (a.popularity || 0), title: (a, b) => a.title.localeCompare(b.title), composer: (a, b) => a.composer.localeCompare(b.composer) || a.title.localeCompare(b.title),
      year: (a, b) => (a.year || 9999) - (b.year || 9999), difficulty: (a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title), duration: (a, b) => a.duration - b.duration }[this.sort];
    list = list.slice().sort(key);
    const L = this.$('list'); L.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const s of list) {
      const row = el('div', 'song');
      row.innerHTML = `<div class="diff d${s.difficulty}" title="Difficulty ${s.difficulty}/5">${'●'.repeat(s.difficulty)}${'○'.repeat(5 - s.difficulty)}</div>
        <div class="meta"><div class="t">${esc(s.title)}</div><div class="c">${esc(s.composer)}${s.year ? ' · ' + s.year : ''} · <span class="g">${esc(s.genre)}</span></div></div>
        <div class="right"><div class="dur">${fmt(s.duration)}</div><div class="lic">${esc(LIC_SHORT(s.license))}</div></div>`;
      row.addEventListener('click', () => this.h.onPlay(s));
      frag.appendChild(row);
    }
    L.appendChild(frag);
    if (!list.length) L.innerHTML = '<div class="empty">No songs match.</div>';
  }
  showMenu() { this.$('menu').classList.remove('hidden'); this.$('hud').classList.add('hidden'); this.$('results').classList.add('hidden'); this.$('pause').classList.add('hidden'); }
  showLoading(on, text) { this.$('loading').classList.toggle('hidden', !on); if (text) this.$('loadingText').textContent = text; }
  showHud(entry, game) {
    this.$('menu').classList.add('hidden'); this.$('results').classList.add('hidden'); this.$('hud').classList.remove('hidden');
    this.$('hudTitle').textContent = entry.title; this.$('hudComposer').textContent = entry.composer || '';
    this.$('hudCombo').textContent = ''; this.$('hudJudge').textContent = ''; this.updateHud(game);
  }
  updateHud(g) {
    this.$('hudScore').textContent = g.score.toLocaleString();
    const judged = g.hits.perfect + g.hits.good + g.hits.miss; const acc = judged ? (g.hits.perfect + g.hits.good * 0.6) / judged : 1;
    this.$('hudAcc').textContent = Math.round(acc * 100) + '%';
    this.$('healthFill').style.width = g.health + '%'; this.$('healthFill').style.background = g.health < 30 ? '#ff3b5c' : g.health < 60 ? '#ffb347' : '#5cffc9';
    this.$('progFill').style.width = (g.progress * 100) + '%';
  }
  flash(kind, combo) {
    const j = this.$('hudJudge'); const c = this.$('hudCombo');
    const label = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS', hold: 'HOLD', empty: '' }[kind];
    j.textContent = label; j.className = kind; j.style.animation = 'none'; void j.offsetWidth; j.style.animation = '';
    if (combo >= 5) { c.textContent = combo + ' combo'; c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; } else if (kind === 'miss' || kind === 'empty') c.textContent = '';
  }
  showPaused(on) { this.$('pause').classList.toggle('hidden', !on); }
  showResults(r) {
    this.$('hud').classList.add('hidden'); this.$('results').classList.remove('hidden');
    this.$('resTitle').textContent = r.cleared ? (r.accuracy > 0.95 ? 'Perfect run' : 'Song cleared') : 'Game over';
    this.$('resSong').textContent = `${r.entry.title} — ${r.entry.composer}`;
    const cells = [['Score', r.score.toLocaleString()], ['Accuracy', Math.round(r.accuracy * 100) + '%'], ['Max combo', r.maxCombo], ['Perfect', r.perfect], ['Good', r.good], ['Missed', r.miss + (r.dropped ? ` (+${r.dropped} dropped)` : '') + (r.empty ? ` (+${r.empty} empty)` : '')], ['Holds', r.holds || 0]];
    this.$('resGrid').innerHTML = cells.map(([k, v]) => `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  }
  showCredits() {
    const L = this.$('creditList'); L.innerHTML = '';
    for (const s of this.songs.slice().sort((a, b) => a.title.localeCompare(b.title))) {
      const who = s.source === 'OpenGameArt.org' ? `by ${esc(s.composer)}` : `${esc(s.composer)}${s.typesetter ? ' · typeset by ' + esc(s.typesetter) : ''}`;
      L.appendChild(el('div', 'credit', `<b>${esc(s.title)}</b> — ${who} · <a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(s.source)}</a> · ${esc(LIC_SHORT(s.license))}`));
    }
    this.$('credits').classList.remove('hidden');
  }
  toast(msg, ms = 2600) { const t = this.$('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.add('hidden'), ms); }
  showDrop(on) { this.$('drop').classList.toggle('hidden', !on); }
}
