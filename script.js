/* ================================================
   MITHILA RADIO — Core Engine
   Features: YT Player, Scheduler, TTS Host,
             Live Mode, Madhubani Canvas, Stats
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
  currentPlaylistIndex: 0,
  playedSongs: 0,
  startTime: Date.now(),
  announcementTimer: null,
  playlistTimer: null,
  listenerTimer: null,
  uptimeTimer: null,
  retryCount: 0,
  maxRetries: 3,
  progressInterval: null,
  playSeconds: 0,
  festivalMode: null,
  ytReady: false,
  pendingPlay: false,
};

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
  // Start playing once YT API ready
  if (State.ytReady) startAutoPlay();
  else State.pendingPlay = true;
}

async function loadConfig() {
  const resp = await fetch('config.json');
  if (!resp.ok) throw new Error('no config');
  return resp.json();
}

function getDefaultConfig() {
  return {
    station: { name: 'Mithila Radio', tagline: 'मिथिलाक आवाज़', whatsapp: '' },
    schedule: {
      morning:   { start:5,  end:11, category:'bhajan',  label:'Pratah Bhajan' },
      afternoon: { start:11, end:16, category:'folk',    label:'Dopahar Geet'  },
      evening:   { start:16, end:20, category:'chhath',  label:'Sandhya Bhajan'},
      night:     { start:20, end:5,  category:'sohar',   label:'Ratri Geet'    },
    },
    categories: [
      { id:'bhajan', label:'Mithila Bhajan', labelMaithili:'भजन',    icon:'🪷', color:'#f59e0b',
        playlists:[{id:'PLbMFMNKwTBqSrb-KFVzS-MFSx6THQZAMD',title:'Mithila Bhajan'}] },
      { id:'folk',   label:'Lok Geet',       labelMaithili:'लोक गीत',icon:'🎵', color:'#10b981',
        playlists:[{id:'PLRBp0Fe2GpglK2eFXGfZbGvJHgOHagjqP',title:'Maithili Folk'}] },
      { id:'chhath', label:'Chhath Geet',    labelMaithili:'छठ गीत', icon:'🌅', color:'#f97316',
        playlists:[{id:'PLbMFMNKwTBqQMRMLM5sMVMmJ0Xu-qxQfm',title:'Chhath Songs'}] },
      { id:'sohar',  label:'Sohar & Vivah',  labelMaithili:'सोहर',   icon:'🎊', color:'#ec4899',
        playlists:[{id:'PLbMFMNKwTBqSFJ7ypbTZ8v6U3fPxnJFtM',title:'Sohar Geet'}] },
      { id:'modern', label:'Modern Maithili',labelMaithili:'आधुनिक', icon:'🎸', color:'#8b5cf6',
        playlists:[{id:'PLbMFMNKwTBqRF5Z2HiGxj_H3J_8fZ8YYb',title:'Modern Maithili'}] },
    ],
    announcements: {
      enabled: true,
      intervalMinutes: 15,
      messages: [
        'Aap sun rahe hain Mithila Radio… maithili sanskriti ke dhun par jhoomein!',
        'Swagat chhe apnar Mithila Radio me… Maithili ke swar sange rahen.',
        'Yeh geet samarpan chhe apnar Mithila ke lor ke…',
        'Mithila Radio pe aap sabka swagat hai… Jai Mithila!',
        'Hamara Mithila… hamari pehchaan… Mithila Radio.',
        'Aap Mithila Radio sun rahe hain — Swargiya Madhubani ke rang aur Mithila ke sur.',
      ]
    },
    festivalMode: {
      chhath:  { name:'Chhath Mahaparv', active:false, category:'chhath', color:'#f97316' },
      wedding: { name:'Vivah Season',    active:false, category:'sohar',  color:'#ec4899' }
    },
    settings: {
      autoPlaylistSwitchMinutes: 45,
      shufflePlaylists: true,
      mockListeners: { enabled: true, base: 847, variance: 200 }
    }
  };
}

// ── YOUTUBE IFRAME API ─────────────────────────
window.onYouTubeIframeAPIReady = function() {
  State.ytReady = true;
  if (State.pendingPlay) startAutoPlay();
};

function createYTPlayer(playlistId, onReady, onStateChange, onError) {
  if (State.player) {
    try { State.player.destroy(); } catch(e) {}
    State.player = null;
  }
  State.player = new YT.Player('yt-player', {
    height: '1', width: '1',
    playerVars: {
      listType:   'playlist',
      list:       playlistId,
      autoplay:   1,
      controls:   0,
      disablekb:  1,
      fs:         0,
      modestbranding: 1,
      rel:        0,
      shuffle:    State.config.settings?.shufflePlaylists ? 1 : 0,
      origin:     window.location.origin || 'https://mithilaradio.netlify.app',
    },
    events: {
      onReady:       onReady       || (() => {}),
      onStateChange: onStateChange || (() => {}),
      onError:       onError       || (() => {}),
    }
  });
}

// ── AUTO PLAY ENGINE ───────────────────────────
function startAutoPlay() {
  const cat = getScheduledCategory();
  playCategory(cat);
  scheduleAnnouncements();
  schedulePlaylistRotation();
}

function getScheduledCategory() {
  if (State.festivalMode) return State.festivalMode;
  const hour = new Date().getHours();
  const sched = State.config.schedule;
  for (const [, slot] of Object.entries(sched)) {
    if (slot.start <= slot.end) {
      if (hour >= slot.start && hour < slot.end) return slot.category;
    } else {
      if (hour >= slot.start || hour < slot.end) return slot.category;
    }
  }
  return 'bhajan';
}

function playCategory(categoryId) {
  const cat = State.config.categories.find(c => c.id === categoryId);
  if (!cat) return;
  State.currentCategory = categoryId;
  const playlists = cat.playlists;
  if (!playlists || !playlists.length) return;
  if (State.config.settings?.shufflePlaylists) {
    State.currentPlaylistIndex = Math.floor(Math.random() * playlists.length);
  }
  const pl = playlists[State.currentPlaylistIndex % playlists.length];

  updateNowPlayingUI(cat, pl);
  setActiveCategory(categoryId);

  createYTPlayer(
    pl.id,
    (e) => {
      try {
        e.target.setVolume(parseInt(document.getElementById('volume-slider').value));
        e.target.playVideo();
      } catch(err) {}
    },
    (e) => handlePlayerStateChange(e, cat, pl),
    (e) => handlePlayerError(e, categoryId)
  );
}

function handlePlayerStateChange(event, cat, pl) {
  const YT_PLAYING = 1, YT_PAUSED = 2, YT_ENDED = 0, YT_BUFFERING = 3;
  switch(event.data) {
    case YT_PLAYING:
      State.isPlaying = true;
      State.retryCount = 0;
      setPlayingUI(true);
      startProgressCounter();
      State.playedSongs++;
      document.getElementById('stat-songs').textContent = State.playedSongs;
      break;
    case YT_PAUSED:
      State.isPlaying = false;
      setPlayingUI(false);
      stopProgressCounter();
      break;
    case YT_ENDED:
      State.isPlaying = false;
      setPlayingUI(false);
      stopProgressCounter();
      advancePlaylist(cat.id);
      break;
  }
}

function handlePlayerError(event, categoryId) {
  console.warn('YT player error:', event.data);
  State.retryCount++;
  if (State.retryCount <= State.maxRetries) {
    setTimeout(() => {
      advancePlaylist(categoryId);
    }, 3000);
  }
}

function advancePlaylist(categoryId) {
  const cat = State.config.categories.find(c => c.id === categoryId);
  if (!cat) return;
  State.currentPlaylistIndex = (State.currentPlaylistIndex + 1) % cat.playlists.length;
  playCategory(categoryId);
}

// ── SCHEDULE ROTATION ──────────────────────────
function schedulePlaylistRotation() {
  clearTimeout(State.playlistTimer);
  const mins = State.config.settings?.autoPlaylistSwitchMinutes || 45;
  State.playlistTimer = setTimeout(() => {
    if (!State.isLive) {
      const newCat = getScheduledCategory();
      if (newCat !== State.currentCategory) {
        playCategory(newCat);
      } else {
        advancePlaylist(newCat);
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
  const msgs = cfg.messages;
  const msg = text || msgs[Math.floor(Math.random() * msgs.length)];

  // Show visual
  const card = document.getElementById('announcement-card');
  const textEl = document.getElementById('announcement-text');
  textEl.textContent = msg;
  card.style.display = 'flex';
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = 'fade-in 0.5s ease';

  // TTS
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(msg);
    utt.lang = 'hi-IN';
    utt.rate = 0.88;
    utt.pitch = 1.05;
    utt.volume = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const hiVoice = voices.find(v => v.lang.startsWith('hi') || v.name.includes('Hindi'));
    if (hiVoice) utt.voice = hiVoice;
    window.speechSynthesis.speak(utt);
    utt.onend = () => {
      setTimeout(() => { card.style.display = 'none'; }, 2000);
    };
  } else {
    setTimeout(() => { card.style.display = 'none'; }, 6000);
  }
}

// ── UI UPDATE ──────────────────────────────────
function updateNowPlayingUI(cat, pl) {
  document.getElementById('song-title').textContent = pl.title || cat.label;
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
  const arm = document.getElementById('vinyl-arm');
  const waveform = document.getElementById('waveform');

  if (playing) {
    vinyl.classList.add('spinning');
    arm.classList.add('playing');
    waveform.classList.remove('paused');
  } else {
    vinyl.classList.remove('spinning');
    arm.classList.remove('playing');
    waveform.classList.add('paused');
  }
}

function setActiveCategory(id) {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === id);
  });
}

// ── PROGRESS COUNTER ───────────────────────────
function startProgressCounter() {
  clearInterval(State.progressInterval);
  State.playSeconds = 0;
  const fill = document.getElementById('progress-fill');
  const timeEl = document.getElementById('play-time');
  State.progressInterval = setInterval(() => {
    State.playSeconds++;
    const pct = Math.min((State.playSeconds / 240) * 100, 99);
    fill.style.width = pct + '%';
    timeEl.textContent = formatTime(State.playSeconds);
  }, 1000);
}

function stopProgressCounter() {
  clearInterval(State.progressInterval);
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('play-time').textContent = '00:00';
  State.playSeconds = 0;
}

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ── SCHEDULE RENDER ────────────────────────────
function renderSchedule() {
  const list = document.getElementById('schedule-list');
  if (!list) return;
  const sched = State.config.schedule;
  const cats = State.config.categories;
  const hour = new Date().getHours();
  list.innerHTML = '';

  const slots = [
    { key:'morning',   time:'5 AM – 11 AM' },
    { key:'afternoon', time:'11 AM – 4 PM'  },
    { key:'evening',   time:'4 PM – 8 PM'   },
    { key:'night',     time:'8 PM – 5 AM'   },
  ];

  slots.forEach(({ key, time }) => {
    const slot = sched[key];
    if (!slot) return;
    const cat = cats.find(c => c.id === slot.category);
    let isActive = false;
    if (slot.start <= slot.end) {
      isActive = hour >= slot.start && hour < slot.end;
    } else {
      isActive = hour >= slot.start || hour < slot.end;
    }
    const el = document.createElement('div');
    el.className = 'schedule-item' + (isActive ? ' active' : '');
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
  const cats = State.config.categories;
  const hour = new Date().getHours();
  const slots = ['morning','afternoon','evening','night'];
  let currentSlot, nextSlot;

  for (let i = 0; i < slots.length; i++) {
    const s = sched[slots[i]];
    let active = false;
    if (s.start <= s.end) active = hour >= s.start && hour < s.end;
    else active = hour >= s.start || hour < s.end;
    if (active) {
      currentSlot = { key: slots[i], slot: s };
      nextSlot = { slot: sched[slots[(i+1) % slots.length]] };
      break;
    }
  }

  if (currentSlot) {
    const cat = cats.find(c => c.id === currentSlot.slot.category);
    const nextCat = cats.find(c => c.id === nextSlot?.slot?.category);
    document.getElementById('block-time').textContent = currentSlot.slot.label;
    document.getElementById('block-name').textContent = (cat?.icon || '') + ' ' + (cat?.label || '');
    document.getElementById('block-next').textContent = nextCat ? nextCat.icon + ' ' + nextCat.label : '—';
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
    btn.onclick = () => {
      if (!State.isLive) playCategory(cat.id);
    };
    grid.appendChild(btn);
  });
}

// ── LISTENER COUNTER ───────────────────────────
function startListenerCounter() {
  const cfg = State.config.settings?.mockListeners;
  if (!cfg?.enabled) return;
  const base = cfg.base || 847;
  const variance = cfg.variance || 200;
  const update = () => {
    const count = base + Math.floor((Math.random() - 0.3) * variance);
    const formatted = count.toLocaleString('en-IN');
    document.getElementById('listener-num').textContent = formatted;
    document.getElementById('stat-listeners').textContent = formatted;
  };
  update();
  State.listenerTimer = setInterval(update, 8000 + Math.random() * 4000);
}

// ── UPTIME COUNTER ─────────────────────────────
function startUptimeCounter() {
  State.uptimeTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - State.startTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const str = h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    document.getElementById('stat-uptime').textContent = str;
  }, 1000);
}

// ── CONTROLS BINDING ───────────────────────────
function bindControls() {
  // Play/Pause
  document.getElementById('btn-play').onclick = () => {
    if (!State.player) return;
    if (State.isPlaying) {
      State.player.pauseVideo();
    } else {
      State.player.playVideo();
    }
  };
  // Next
  document.getElementById('btn-next').onclick = () => {
    if (!State.player || State.isLive) return;
    try { State.player.nextVideo(); } catch(e) { advancePlaylist(State.currentCategory); }
  };
  // Prev
  document.getElementById('btn-prev').onclick = () => {
    if (!State.player || State.isLive) return;
    try { State.player.previousVideo(); } catch(e) {}
  };
  // Volume
  document.getElementById('volume-slider').oninput = (e) => {
    if (State.player) {
      try { State.player.setVolume(parseInt(e.target.value)); } catch(err) {}
    }
  };
  // Mode toggle
  document.getElementById('mode-toggle').onclick = () => {
    if (State.isLive) endLiveMode();
    else startLiveMode();
  };
}

// ── LIVE MODE ──────────────────────────────────
function startLiveMode() {
  State.isLive = true;
  clearTimeout(State.announcementTimer);
  clearTimeout(State.playlistTimer);
  if (State.player) {
    try { State.player.pauseVideo(); } catch(e) {}
  }
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
  document.getElementById('btn-mic').classList.remove('active');
  document.getElementById('btn-mic').textContent = 'Start Mic';
  document.querySelector('.mic-bars')?.classList.remove('active');
  document.getElementById('mode-toggle').classList.remove('active');
  document.getElementById('live-panel').style.display = 'none';
  document.getElementById('category-selector').style.display = '';
  if (State.player) {
    try { State.player.playVideo(); } catch(e) {}
  }
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
  const fm = State.config.festivalMode;
  if (!fm || !fm[type]) return;
  State.festivalMode = fm[type].category;
  const banner = document.getElementById('festival-banner');
  document.getElementById('festival-icon').textContent = type === 'chhath' ? '🌅' : '🎊';
  document.getElementById('festival-text').textContent = fm[type].name + ' Special Broadcast';
  banner.style.display = 'flex';
  document.querySelectorAll('.btn-festival').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + type)?.classList.add('active');
  if (!State.isLive) playCategory(fm[type].category);
  triggerAnnouncement((type === 'chhath' ? 'Chhath Mahaparv ki shubhkamnayen!' : 'Vivah Season — Maithili Mangal Geet!') + ' Mithila Radio pe.');
}

function deactivateFestival() {
  State.festivalMode = null;
  document.getElementById('festival-banner').style.display = 'none';
  document.querySelectorAll('.btn-festival').forEach(b => b.classList.remove('active'));
  if (!State.isLive) playCategory(getScheduledCategory());
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
  // Draw a stylized Mithila lotus mandala in SVG
  const size = 140;
  const cx = size / 2, cy = size / 2;
  const r1 = 60, r2 = 42, r3 = 24;
  const petals = 8;
  let petalPaths = '';
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const a2 = ((i + 0.5) / petals) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * r2;
    const y1 = cy + Math.sin(a) * r2;
    const x2 = cx + Math.cos(a) * r1;
    const y2 = cy + Math.sin(a) * r1;
    const xc = cx + Math.cos(a2) * r1;
    const yc = cy + Math.sin(a2) * r1;
    const xe = cx + Math.cos(a + Math.PI * 2 / petals) * r2;
    const ye = cy + Math.sin(a + Math.PI * 2 / petals) * r2;
    petalPaths += `<path d="M${x1},${y1} Q${xc},${yc} ${xe},${ye} L${cx},${cy} Z"
      fill="none" stroke="#f59e0b" stroke-width="1.2" opacity="0.7"/>`;
  }
  // inner petals
  let innerPetals = '';
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + Math.PI / petals;
    const a2 = ((i + 0.5) / petals) * Math.PI * 2 + Math.PI / petals;
    const x1 = cx + Math.cos(a) * r3;
    const y1 = cy + Math.sin(a) * r3;
    const x2 = cx + Math.cos(a) * r2;
    const y2 = cy + Math.sin(a) * r2;
    const xc = cx + Math.cos(a2) * r2;
    const yc = cy + Math.sin(a2) * r2;
    const xe = cx + Math.cos(a + Math.PI * 2 / petals) * r3;
    const ye = cy + Math.sin(a + Math.PI * 2 / petals) * r3;
    innerPetals += `<path d="M${x1},${y1} Q${xc},${yc} ${xe},${ye} L${cx},${cy} Z"
      fill="none" stroke="#fb923c" stroke-width="1" opacity="0.6"/>`;
  }
  // dots
  let dots = '';
  for (let i = 0; i < petals * 2; i++) {
    const a = (i / (petals * 2)) * Math.PI * 2;
    const rx = cx + Math.cos(a) * (r1 + 6);
    const ry = cy + Math.sin(a) * (r1 + 6);
    dots += `<circle cx="${rx}" cy="${ry}" r="2" fill="#f59e0b" opacity="0.5"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"
    style="width:100%;height:100%;animation:spin-slow 30s linear infinite">
    <circle cx="${cx}" cy="${cy}" r="${r1+8}" fill="none" stroke="#f59e0b22" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="#f59e0b33" stroke-width="0.8"/>
    ${petalPaths}${innerPetals}
    <circle cx="${cx}" cy="${cy}" r="${r3}" fill="none" stroke="#ec489966" stroke-width="1.2"/>
    <circle cx="${cx}" cy="${cy}" r="8" fill="#f59e0b22" stroke="#f59e0b" stroke-width="1.5"/>
    ${dots}
    <text x="${cx}" y="${cy+5}" text-anchor="middle" font-size="10" fill="#f59e0b" opacity="0.9">🪷</text>
  </svg>`;
}

// ── BACKGROUND CANVAS (Madhubani Patterns) ────
function drawBgCanvas() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 0.6;
    // Grid of lotus motifs
    const spacing = 140;
    for (let x = 0; x < canvas.width + spacing; x += spacing) {
      for (let y = 0; y < canvas.height + spacing; y += spacing) {
        drawMotiif(ctx, x, y, 30);
      }
    }
  }
  function drawMotiif(ctx, cx, cy, r) {
    const petals = 6;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const a2 = ((i + 0.5) / petals) * Math.PI * 2;
      const x1 = cx + Math.cos(a) * (r * 0.4);
      const y1 = cy + Math.sin(a) * (r * 0.4);
      const xc = cx + Math.cos(a2) * r;
      const yc = cy + Math.sin(a2) * r;
      const xe = cx + Math.cos(a + Math.PI * 2 / petals) * (r * 0.4);
      const ye = cy + Math.sin(a + Math.PI * 2 / petals) * (r * 0.4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(xc, yc, xe, ye);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
    ctx.stroke();
  }
  window.addEventListener('resize', resize);
  resize();
}

// ── BOOT ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
