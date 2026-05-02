/* ================================================
   MITHILA RADIO — Core Engine v2
   Robust 3-tier playback:
     Tier 1: YouTube playlist embed
     Tier 2: Individual video list (error 150/101 safe)
     Tier 3: Next category fallback
   ================================================ */

'use strict';

// ── STATE ──────────────────────────────────────
const State = {
  config: null,
  player: null,
  isPlaying: false,
  isLive: false,
  micStream: null,
  currentCategory: null,

  // Playback queue state
  mode: 'playlist',   // 'playlist' | 'video'
  playlistIndex: 0,   // which playlist in category.playlists[]
  videoIndex: 0,      // which video in category.videos[]
  consecutiveErrors: 0,

  playedSongs: 0,
  startTime: Date.now(),
  announcementTimer: null,
  playlistTimer: null,
  listenerTimer: null,
  uptimeTimer: null,
  progressInterval: null,
  playSeconds: 0,
  festivalMode: null,
  ytReady: false,
  pendingPlay: false,
};

// Error codes that mean "embed not allowed" — skip immediately, never retry
const EMBED_BLOCKED = new Set([101, 150]);
// Error codes that mean "video unavailable" — skip
const VIDEO_UNAVAIL = new Set([100, 5]);

// ── INIT ───────────────────────────────────────
async function init() {
  try {
    State.config = await loadConfig();
  } catch(e) {
    console.warn('config.json not found, using defaults:', e);
    State.config = getDefaultConfig();
  }
  renderSchedule();
  renderCategories();
  updateScheduleBlock();
  startListenerCounter();
  startUptimeCounter();
  drawMadhubaniArt();
  drawBgCanvas();
  bindControls();
  setupWhatsApp();
  if (State.ytReady) startAutoPlay();
  else State.pendingPlay = true;
}

async function loadConfig() {
  const resp = await fetch('config.json');
  if (!resp.ok) throw new Error('no config');
  return resp.json();
}

// ── YOUTUBE IFRAME API ─────────────────────────
window.onYouTubeIframeAPIReady = function() {
  State.ytReady = true;
  if (State.pendingPlay) startAutoPlay();
};

// ── PLAYER FACTORY ─────────────────────────────
// mode 'playlist': playerVars uses list + listType
// mode 'video':    playerVars uses videoId
function buildPlayer({ mode, id, onReady, onStateChange, onError }) {
  if (State.player) {
    try { State.player.destroy(); } catch(e) {}
    State.player = null;
  }
  // Recreate the div (YT API consumes it)
  const container = document.getElementById('yt-player-container');
  container.innerHTML = '<div id="yt-player"></div>';

  const baseVars = {
    autoplay: 1, controls: 0, disablekb: 1,
    fs: 0, modestbranding: 1, rel: 0,
    origin: window.location.origin || 'https://mithilaradio.netlify.app',
  };

  let playerConfig;
  if (mode === 'playlist') {
    playerConfig = {
      height: '1', width: '1',
      playerVars: { ...baseVars, listType: 'playlist', list: id,
        shuffle: State.config.settings?.shufflePlaylists ? 1 : 0 },
      events: { onReady, onStateChange, onError }
    };
  } else {
    playerConfig = {
      height: '1', width: '1',
      videoId: id,
      playerVars: { ...baseVars },
      events: { onReady, onStateChange, onError }
    };
  }
  State.player = new YT.Player('yt-player', playerConfig);
}

// ── AUTO PLAY ENGINE ───────────────────────────
function startAutoPlay() {
  const cat = getScheduledCategory();
  startCategoryPlayback(cat);
  scheduleAnnouncements();
  schedulePlaylistRotation();
}

function getScheduledCategory() {
  if (State.festivalMode) return State.festivalMode;
  const hour = new Date().getHours();
  const sched = State.config.schedule;
  for (const slot of Object.values(sched)) {
    const active = slot.start <= slot.end
      ? hour >= slot.start && hour < slot.end
      : hour >= slot.start || hour < slot.end;
    if (active) return slot.category;
  }
  return 'bhajan';
}

// ── CATEGORY PLAYBACK ──────────────────────────
function startCategoryPlayback(categoryId) {
  const cat = getCat(categoryId);
  if (!cat) return;

  State.currentCategory = categoryId;
  State.consecutiveErrors = 0;
  setActiveCategory(categoryId);

  // Tier 1: try first playlist
  const playlists = cat.playlists || [];
  if (playlists.length > 0) {
    State.mode = 'playlist';
    State.playlistIndex = 0;
    playCurrentSource(cat);
  } else {
    // No playlists configured — go straight to videos
    State.mode = 'video';
    State.videoIndex = 0;
    playCurrentSource(cat);
  }
}

function playCurrentSource(cat) {
  if (State.mode === 'playlist') {
    const pl = (cat.playlists || [])[State.playlistIndex];
    if (!pl) {
      // Fall through to video mode
      State.mode = 'video';
      State.videoIndex = 0;
      playCurrentSource(cat);
      return;
    }
    console.log(`[MR] Playing playlist: ${pl.id} — ${pl.title}`);
    updateNowPlayingUI(cat, pl.title);
    buildPlayer({
      mode: 'playlist',
      id: pl.id,
      onReady: (e) => {
        try { e.target.setVolume(getVolume()); e.target.playVideo(); } catch(_) {}
      },
      onStateChange: (e) => handleStateChange(e, cat),
      onError: (e) => handleError(e, cat),
    });

  } else {
    // Video mode
    const videos = cat.videos || [];
    if (!videos.length) {
      console.warn('[MR] No videos available for', cat.id);
      tryNextCategory();
      return;
    }
    // Shuffle pick on first entry
    if (State.videoIndex === 0 && State.config.settings?.shufflePlaylists) {
      State.videoIndex = Math.floor(Math.random() * videos.length);
    }
    const vid = videos[State.videoIndex % videos.length];
    console.log(`[MR] Playing video ${State.videoIndex}: ${vid.id} — ${vid.title}`);
    updateNowPlayingUI(cat, vid.title);
    buildPlayer({
      mode: 'video',
      id: vid.id,
      onReady: (e) => {
        try { e.target.setVolume(getVolume()); e.target.playVideo(); } catch(_) {}
      },
      onStateChange: (e) => handleStateChange(e, cat),
      onError: (e) => handleError(e, cat),
    });
  }
}

// ── STATE CHANGE HANDLER ───────────────────────
function handleStateChange(event, cat) {
  const { PLAYING, PAUSED, ENDED, BUFFERING, CUED } = {
    PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3, CUED: 5
  };
  switch (event.data) {
    case PLAYING:
      State.isPlaying = true;
      State.consecutiveErrors = 0;
      setPlayingUI(true);
      startProgressCounter();
      State.playedSongs++;
      document.getElementById('stat-songs').textContent = State.playedSongs;
      break;
    case PAUSED:
      State.isPlaying = false;
      setPlayingUI(false);
      stopProgressCounter();
      break;
    case ENDED:
      State.isPlaying = false;
      setPlayingUI(false);
      stopProgressCounter();
      advanceToNext(cat);
      break;
  }
}

// ── ERROR HANDLER (THE KEY FIX) ───────────────
function handleError(event, cat) {
  const code = event.data;
  console.warn(`[MR] YT Error ${code} on ${State.mode}:${State.currentCategory}`);
  State.consecutiveErrors++;

  if (EMBED_BLOCKED.has(code)) {
    // Error 150 or 101: embedding explicitly disabled by video owner
    // Skip IMMEDIATELY — do not retry this source
    console.warn(`[MR] Embed blocked (${code}). Skipping source.`);
    skipCurrentSource(cat);
    return;
  }

  if (VIDEO_UNAVAIL.has(code)) {
    // Video deleted / region-blocked
    console.warn(`[MR] Video unavailable (${code}). Skipping.`);
    skipCurrentSource(cat);
    return;
  }

  // Unknown error: retry once, then skip
  if (State.consecutiveErrors >= 2) {
    skipCurrentSource(cat);
  } else {
    setTimeout(() => playCurrentSource(cat), 3000);
  }
}

function skipCurrentSource(cat) {
  if (State.mode === 'playlist') {
    // Try next playlist in this category
    State.playlistIndex++;
    const playlists = cat.playlists || [];
    if (State.playlistIndex < playlists.length) {
      console.log(`[MR] Trying next playlist [${State.playlistIndex}]`);
      playCurrentSource(cat);
    } else {
      // All playlists failed → fall back to video list
      console.log('[MR] All playlists failed → switching to video mode');
      State.mode = 'video';
      State.videoIndex = 0;
      playCurrentSource(cat);
    }
  } else {
    // Video mode: try next video
    State.videoIndex++;
    const videos = cat.videos || [];
    if (State.videoIndex < videos.length) {
      console.log(`[MR] Trying next video [${State.videoIndex}]`);
      playCurrentSource(cat);
    } else {
      // All videos in this category failed
      console.warn('[MR] All videos failed in category', cat.id);
      tryNextCategory();
    }
  }
}

function advanceToNext(cat) {
  if (State.mode === 'playlist') {
    // playlist ended normally: let YT auto-advance, or move to next video
    State.videoIndex = 0;
    State.mode = 'video';
    playCurrentSource(cat);
  } else {
    State.videoIndex++;
    const videos = cat.videos || [];
    if (State.videoIndex >= videos.length) {
      State.videoIndex = 0; // loop
    }
    playCurrentSource(cat);
  }
}

function tryNextCategory() {
  const cats = State.config.categories;
  const idx = cats.findIndex(c => c.id === State.currentCategory);
  const next = cats[(idx + 1) % cats.length];
  console.log(`[MR] Falling back to category: ${next.id}`);
  State.mode = 'video';
  State.videoIndex = 0;
  State.currentCategory = next.id;
  setActiveCategory(next.id);
  updateNowPlayingUI(next, next.label);
  playCurrentSource(next);
}

function getCat(id) {
  return State.config.categories.find(c => c.id === id);
}

// ── SCHEDULE ROTATION ──────────────────────────
function schedulePlaylistRotation() {
  clearTimeout(State.playlistTimer);
  const mins = State.config.settings?.autoPlaylistSwitchMinutes || 45;
  State.playlistTimer = setTimeout(() => {
    if (!State.isLive) {
      const newCat = getScheduledCategory();
      if (newCat !== State.currentCategory) {
        startCategoryPlayback(newCat);
      } else {
        // Same category, advance to next video/playlist
        const cat = getCat(State.currentCategory);
        if (cat) advanceToNext(cat);
      }
    }
    schedulePlaylistRotation();
  }, mins * 60 * 1000);
}

// ── AI RADIO HOST (TTS) ────────────────────────
function scheduleAnnouncements() {
  clearTimeout(State.announcementTimer);
  const cfg = State.config.announcements;
  if (!cfg.enabled) return;
  const mins = cfg.intervalMinutes || 15;
  State.announcementTimer = setTimeout(() => {
    triggerAnnouncement();
    scheduleAnnouncements();
  }, mins * 60 * 1000);
}

function triggerAnnouncement(text) {
  const cfg = State.config.announcements;
  const msgs = cfg.messages || [];
  const msg = text || msgs[Math.floor(Math.random() * msgs.length)];
  if (!msg) return;

  const card = document.getElementById('announcement-card');
  const textEl = document.getElementById('announcement-text');
  textEl.textContent = msg;
  card.style.display = 'flex';
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = 'fade-in 0.5s ease';

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const speak = () => {
      const utt = new SpeechSynthesisUtterance(msg);
      utt.lang = 'hi-IN';
      utt.rate = 0.88;
      utt.pitch = 1.05;
      utt.volume = 0.9;
      const voices = window.speechSynthesis.getVoices();
      const hiVoice = voices.find(v =>
        v.lang.startsWith('hi') || v.name.toLowerCase().includes('hindi') || v.name.toLowerCase().includes('india')
      );
      if (hiVoice) utt.voice = hiVoice;
      utt.onend = () => setTimeout(() => { card.style.display = 'none'; }, 2000);
      window.speechSynthesis.speak(utt);
    };
    // Voices may not be loaded yet
    if (window.speechSynthesis.getVoices().length) speak();
    else window.speechSynthesis.onvoiceschanged = speak;
  } else {
    setTimeout(() => { card.style.display = 'none'; }, 6000);
  }
}

// ── UI UPDATE ──────────────────────────────────
function updateNowPlayingUI(cat, title) {
  document.getElementById('song-title').textContent = title || cat.label;
  document.getElementById('song-subtitle').textContent = cat.labelMaithili || cat.label;
  document.getElementById('cat-icon').textContent = cat.icon;
  document.getElementById('cat-label').textContent = cat.label;
  document.getElementById('vinyl-icon').textContent = cat.icon;

  const catTag = document.getElementById('category-tag');
  catTag.style.color = cat.color;
  catTag.style.borderColor = cat.color + '44';
  catTag.style.background = cat.color + '18';

  updateScheduleBlock();
}

function setPlayingUI(playing) {
  document.getElementById('icon-play').style.display  = playing ? 'none' : 'block';
  document.getElementById('icon-pause').style.display = playing ? 'block' : 'none';

  const vinyl = document.getElementById('vinyl-disc');
  const arm   = document.getElementById('vinyl-arm');
  const wave  = document.getElementById('waveform');

  vinyl.classList.toggle('spinning', playing);
  arm.classList.toggle('playing', playing);
  wave.classList.toggle('paused', !playing);
}

function setActiveCategory(id) {
  document.querySelectorAll('.cat-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.id === id)
  );
}

function getVolume() {
  return parseInt(document.getElementById('volume-slider').value) || 80;
}

// ── PROGRESS COUNTER ───────────────────────────
function startProgressCounter() {
  clearInterval(State.progressInterval);
  State.playSeconds = 0;
  const fill  = document.getElementById('progress-fill');
  const timeEl = document.getElementById('play-time');
  State.progressInterval = setInterval(() => {
    State.playSeconds++;
    fill.style.width = Math.min((State.playSeconds / 300) * 100, 99) + '%';
    timeEl.textContent = formatTime(State.playSeconds);
  }, 1000);
}

function stopProgressCounter() {
  clearInterval(State.progressInterval);
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('play-time').textContent = '00:00';
  State.playSeconds = 0;
}

function formatTime(s) {
  const m = String(Math.floor(s / 60)).padStart(2,'0');
  const ss = String(s % 60).padStart(2,'0');
  return `${m}:${ss}`;
}

// ── SCHEDULE RENDER ────────────────────────────
function renderSchedule() {
  const list = document.getElementById('schedule-list');
  if (!list) return;
  const sched = State.config.schedule;
  const hour = new Date().getHours();
  list.innerHTML = '';

  const slots = [
    { key:'morning',   time:'5 AM – 11 AM'  },
    { key:'afternoon', time:'11 AM – 4 PM'  },
    { key:'evening',   time:'4 PM – 8 PM'   },
    { key:'night',     time:'8 PM – 5 AM'   },
  ];

  slots.forEach(({ key, time }) => {
    const slot = sched[key];
    if (!slot) return;
    const cat = getCat(slot.category);
    const active = slot.start <= slot.end
      ? hour >= slot.start && hour < slot.end
      : hour >= slot.start || hour < slot.end;
    const el = document.createElement('div');
    el.className = 'schedule-item' + (active ? ' active' : '');
    el.innerHTML = `
      <span class="sched-dot" style="background:${cat?.color || '#888'}"></span>
      <span class="sched-time">${time}</span>
      <span class="sched-label">${cat?.icon || '🎵'} ${slot.label}</span>
    `;
    list.appendChild(el);
  });
}

function updateScheduleBlock() {
  const sched = State.config.schedule;
  const hour = new Date().getHours();
  const keys = ['morning','afternoon','evening','night'];
  let cur, nxt;
  for (let i = 0; i < keys.length; i++) {
    const s = sched[keys[i]];
    const active = s.start <= s.end
      ? hour >= s.start && hour < s.end
      : hour >= s.start || hour < s.end;
    if (active) {
      cur = { slot: s };
      nxt = { slot: sched[keys[(i+1) % keys.length]] };
      break;
    }
  }
  if (cur) {
    const cat  = getCat(cur.slot.category);
    const ncat = getCat(nxt?.slot?.category);
    document.getElementById('block-time').textContent = cur.slot.label;
    document.getElementById('block-name').textContent = (cat?.icon||'') + ' ' + (cat?.label||'');
    document.getElementById('block-next').textContent = ncat ? ncat.icon+' '+ncat.label : '—';
  }
}

// ── CATEGORY RENDER ────────────────────────────
function renderCategories() {
  const grid = document.getElementById('category-grid');
  if (!grid) return;
  grid.innerHTML = '';
  State.config.categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn';
    btn.dataset.id = cat.id;
    btn.innerHTML = `
      <span class="cat-icon">${cat.icon}</span>
      <span class="cat-label-main" style="color:${cat.color}">${cat.labelMaithili}</span>
      <span class="cat-label">${cat.label}</span>
    `;
    btn.onclick = () => { if (!State.isLive) startCategoryPlayback(cat.id); };
    grid.appendChild(btn);
  });
}

// ── LISTENER COUNTER ───────────────────────────
function startListenerCounter() {
  const cfg = State.config.settings?.mockListeners;
  if (!cfg?.enabled) return;
  const base = cfg.base || 847, variance = cfg.variance || 200;
  const update = () => {
    const n = base + Math.floor((Math.random() - 0.3) * variance);
    const f = n.toLocaleString('en-IN');
    document.getElementById('listener-num').textContent = f;
    document.getElementById('stat-listeners').textContent = f;
  };
  update();
  State.listenerTimer = setInterval(update, 8000 + Math.random() * 4000);
}

// ── UPTIME COUNTER ─────────────────────────────
function startUptimeCounter() {
  State.uptimeTimer = setInterval(() => {
    const e = Math.floor((Date.now() - State.startTime) / 1000);
    const h = Math.floor(e / 3600);
    const m = Math.floor((e % 3600) / 60);
    const s = e % 60;
    document.getElementById('stat-uptime').textContent = h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

// ── CONTROLS BINDING ───────────────────────────
function bindControls() {
  document.getElementById('btn-play').onclick = () => {
    if (!State.player) return;
    try {
      if (State.isPlaying) State.player.pauseVideo();
      else State.player.playVideo();
    } catch(e) {}
  };
  document.getElementById('btn-next').onclick = () => {
    if (!State.player || State.isLive) return;
    const cat = getCat(State.currentCategory);
    if (cat) {
      if (State.mode === 'playlist') {
        try { State.player.nextVideo(); } catch(e) { advanceToNext(cat); }
      } else {
        advanceToNext(cat);
      }
    }
  };
  document.getElementById('btn-prev').onclick = () => {
    if (!State.player || State.isLive) return;
    try { State.player.previousVideo(); } catch(e) {}
  };
  document.getElementById('volume-slider').oninput = (e) => {
    if (State.player) try { State.player.setVolume(parseInt(e.target.value)); } catch(_) {}
  };
  document.getElementById('mode-toggle').onclick = () => {
    if (State.isLive) endLiveMode(); else startLiveMode();
  };
}

// ── LIVE MODE ──────────────────────────────────
function startLiveMode() {
  State.isLive = true;
  clearTimeout(State.announcementTimer);
  clearTimeout(State.playlistTimer);
  try { State.player?.pauseVideo(); } catch(e) {}
  setPlayingUI(false);
  document.getElementById('mode-toggle').classList.add('active');
  document.getElementById('live-panel').style.display = 'block';
  document.getElementById('category-selector').style.display = 'none';
  document.getElementById('song-title').textContent = 'Live Broadcast';
  document.getElementById('song-subtitle').textContent = 'Manual Hosting Mode';
}

function endLiveMode() {
  State.isLive = false;
  if (State.micStream) {
    State.micStream.getTracks().forEach(t => t.stop());
    State.micStream = null;
  }
  const micBtn = document.getElementById('btn-mic');
  micBtn.classList.remove('active');
  micBtn.textContent = 'Start Mic';
  document.querySelector('.mic-bars')?.classList.remove('active');
  document.getElementById('mode-toggle').classList.remove('active');
  document.getElementById('live-panel').style.display = 'none';
  document.getElementById('category-selector').style.display = '';
  try { State.player?.playVideo(); } catch(e) {}
  scheduleAnnouncements();
  schedulePlaylistRotation();
  triggerAnnouncement('Mithila Radio phir se LIVE hai… Sun-te rahen!');
}

async function toggleMic() {
  const btn = document.getElementById('btn-mic');
  const micBars = document.querySelector('.mic-bars');
  if (State.micStream) {
    State.micStream.getTracks().forEach(t => t.stop());
    State.micStream = null;
    btn.textContent = 'Start Mic';
    btn.classList.remove('active');
    micBars?.classList.remove('active');
  } else {
    try {
      State.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      btn.textContent = 'Mic Active 🔴';
      btn.classList.add('active');
      micBars?.classList.add('active');
    } catch(e) {
      alert('Mic access denied. Please allow microphone in browser settings.');
    }
  }
}

// ── FESTIVAL MODE ──────────────────────────────
function activateFestival(type) {
  const fm = State.config.festivalMode?.[type];
  if (!fm) return;
  State.festivalMode = fm.category;
  document.getElementById('festival-icon').textContent = type === 'chhath' ? '🌅' : '🎊';
  document.getElementById('festival-text').textContent = fm.name + ' Special Broadcast';
  document.getElementById('festival-banner').style.display = 'flex';
  document.querySelectorAll('.btn-festival').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + type)?.classList.add('active');
  if (!State.isLive) startCategoryPlayback(fm.category);
  triggerAnnouncement(
    type === 'chhath'
      ? 'Chhath Mahaparv ki shubhkamnayen! Mithila Radio pe.'
      : 'Vivah Season — Maithili Mangal Geet! Mithila Radio pe.'
  );
}

function deactivateFestival() {
  State.festivalMode = null;
  document.getElementById('festival-banner').style.display = 'none';
  document.querySelectorAll('.btn-festival').forEach(b => b.classList.remove('active'));
  if (!State.isLive) startCategoryPlayback(getScheduledCategory());
}

// ── WHATSAPP SHARE ─────────────────────────────
function setupWhatsApp() {
  const btn = document.getElementById('whatsapp-share');
  const url = State.config?.station?.whatsapp ||
    `https://wa.me/?text=${encodeURIComponent('Sun Mithila Radio — 24/7 Maithili Folk, Bhajan, Chhath Geet FREE! ' + window.location.href)}`;
  btn.onclick = () => window.open(url, '_blank');
}

// ── MADHUBANI ART SVG ──────────────────────────
function drawMadhubaniArt() {
  const el = document.getElementById('madhubani-art');
  if (!el) return;
  const size = 140, cx = 70, cy = 70;
  const r1 = 60, r2 = 42, r3 = 24, petals = 8;
  let outer = '', inner = '', dots = '';
  for (let i = 0; i < petals; i++) {
    const a  = (i / petals) * Math.PI * 2;
    const a2 = ((i + 0.5) / petals) * Math.PI * 2;
    const a3 = ((i + 1) / petals) * Math.PI * 2;
    outer += `<path d="M${cx+Math.cos(a)*r2},${cy+Math.sin(a)*r2} Q${cx+Math.cos(a2)*r1},${cy+Math.sin(a2)*r1} ${cx+Math.cos(a3)*r2},${cy+Math.sin(a3)*r2} L${cx},${cy} Z" fill="none" stroke="#f59e0b" stroke-width="1.2" opacity="0.7"/>`;
    const b  = a + Math.PI / petals;
    const b2 = a2 + Math.PI / petals;
    const b3 = a3 + Math.PI / petals;
    inner += `<path d="M${cx+Math.cos(b)*r3},${cy+Math.sin(b)*r3} Q${cx+Math.cos(b2)*r2},${cy+Math.sin(b2)*r2} ${cx+Math.cos(b3)*r3},${cy+Math.sin(b3)*r3} L${cx},${cy} Z" fill="none" stroke="#fb923c" stroke-width="1" opacity="0.6"/>`;
    dots += `<circle cx="${cx+Math.cos(a)*(r1+6)}" cy="${cy+Math.sin(a)*(r1+6)}" r="2" fill="#f59e0b" opacity="0.5"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;animation:spin-slow 30s linear infinite">
    <circle cx="${cx}" cy="${cy}" r="${r1+8}" fill="none" stroke="#f59e0b22" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="#f59e0b33" stroke-width="0.8"/>
    ${outer}${inner}
    <circle cx="${cx}" cy="${cy}" r="${r3}" fill="none" stroke="#ec489966" stroke-width="1.2"/>
    <circle cx="${cx}" cy="${cy}" r="8" fill="#f59e0b22" stroke="#f59e0b" stroke-width="1.5"/>
    ${dots}
  </svg>`;
}

// ── BACKGROUND CANVAS ──────────────────────────
function drawBgCanvas() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; draw(); }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 0.6;
    for (let x = 0; x < canvas.width + 140; x += 140)
      for (let y = 0; y < canvas.height + 140; y += 140)
        drawMotif(ctx, x, y, 30);
  }
  function drawMotif(ctx, cx, cy, r) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, a2 = ((i+0.5)/6)*Math.PI*2, a3 = ((i+1)/6)*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(cx+Math.cos(a)*r*0.4, cy+Math.sin(a)*r*0.4);
      ctx.quadraticCurveTo(cx+Math.cos(a2)*r, cy+Math.sin(a2)*r, cx+Math.cos(a3)*r*0.4, cy+Math.sin(a3)*r*0.4);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, r*0.18, 0, Math.PI*2); ctx.stroke();
  }
  window.addEventListener('resize', resize);
  resize();
}

// ── DEFAULT CONFIG ─────────────────────────────
function getDefaultConfig() {
  return {
    station: { name: 'Mithila Radio', tagline: 'मिथिलाक आवाज़', whatsapp: '' },
    schedule: {
      morning:   { start:5,  end:11, category:'bhajan',  label:'Pratah Bhajan'    },
      afternoon: { start:11, end:16, category:'folk',    label:'Dopahar Lok Geet' },
      evening:   { start:16, end:20, category:'chhath',  label:'Sandhya Bhajan'   },
      night:     { start:20, end:5,  category:'sohar',   label:'Ratri Geet'       },
    },
    categories: [
      { id:'bhajan', label:'Mithila Bhajan', labelMaithili:'भजन',     icon:'🪷', color:'#f59e0b',
        playlists:[{id:'PLePlt4JAqndt1j5nH68-9kXDgtcZ5Tywd', title:'Maithili Shiv Bhajan'}],
        videos:[
          {id:'92tSlnvQ0lc',title:'Sawan Shiv Bhajan 2024'},
          {id:'HDLXbQts0KA',title:'Baba Kholiyo — Nachari'},
          {id:'wXZEKz0lx-s',title:'Bhole Baba Nachari'},
          {id:'5i19zjL60XA',title:'Gauri Shiv Manavati 2024'},
          {id:'8ezyhfZgBeE',title:'Bhola Jaay Diyo Naihara'},
        ]},
      { id:'folk',   label:'Lok Geet',       labelMaithili:'लोक गीत', icon:'🎵', color:'#10b981',
        playlists:[],
        videos:[
          {id:'khjTorvaYBg',title:'Gauri Ke Aangan — Sohar'},
          {id:'Ruh-ZMpD_m0',title:'Kone Nagar Se Aayel'},
          {id:'ZKPle3aGMIE',title:'Suruj Dev Ke Man Sau'},
          {id:'s2XnB-_X5zY',title:'Top 5 Maithili Chhath 2020'},
        ]},
      { id:'chhath', label:'Chhath Geet',    labelMaithili:'छठ गीत',  icon:'🌅', color:'#f97316',
        playlists:[{id:'PLePlt4JAqndvPqe_-ei1aLS-44bsGE0aK', title:'Maithili Chhath — Lok Kala Kendra'}],
        videos:[
          {id:'DG8F-csoRAQ',title:'Pahile Pahil Chhathi Maiya'},
          {id:'wJ7p79QWgLg',title:'Ganga Ji Ke Paniyan'},
          {id:'s2XnB-_X5zY',title:'Top 5 Chhath Geet 2020'},
          {id:'1U5Sk9_ZRh4',title:'Top 5 Chhath Geet 2023'},
          {id:'y7hrM7PouQM',title:'Kelwa Ke Paat Par'},
        ]},
      { id:'sohar',  label:'Sohar & Vivah',  labelMaithili:'सोहर',    icon:'🎊', color:'#ec4899',
        playlists:[],
        videos:[
          {id:'khjTorvaYBg',title:'Gauri Ke Aangan'},
          {id:'Ruh-ZMpD_m0',title:'Kone Nagar Se Aayel'},
          {id:'HDLXbQts0KA',title:'Shiv Nachari — Mangal'},
        ]},
      { id:'modern', label:'Modern Maithili', labelMaithili:'आधुनिक', icon:'🎸', color:'#8b5cf6',
        playlists:[],
        videos:[
          {id:'92tSlnvQ0lc',title:'Maithili 2024'},
          {id:'5i19zjL60XA',title:'Special Song 2024'},
          {id:'o5KckJ6bLg4',title:'Superhit 2024'},
        ]},
    ],
    announcements: {
      enabled: true, intervalMinutes: 15,
      messages: [
        'Aap sun rahe hain Mithila Radio… maithili sanskriti ke dhun par jhoomein!',
        'Swagat chhe apnar Mithila Radio me… Maithili ke swar sange rahen.',
        'Mithila Radio pe aap sabka swagat hai… Jai Mithila!',
        'Hamara Mithila… hamari pehchaan… Mithila Radio.',
      ]
    },
    festivalMode: {
      chhath:  { name:'Chhath Mahaparv', active:false, category:'chhath', color:'#f97316' },
      wedding: { name:'Vivah Season',    active:false, category:'sohar',  color:'#ec4899' }
    },
    settings: { autoPlaylistSwitchMinutes:45, shufflePlaylists:true,
      mockListeners: { enabled:true, base:847, variance:200 } }
  };
}

// ── BOOT ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
