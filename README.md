# 🪷 Mithila Radio — मिथिलाक आवाज़

> **24/7 Free Maithili Folk, Bhajan & Cultural Music Streaming**  
> *The living voice of Mithila culture — forever free, zero backend cost.*

---

## 🎯 What This Is

A production-ready, fully automated Maithili online radio that:
- Streams Maithili music via embedded YouTube playlists (100% legal)
- Has a premium Madhubani art-inspired dark UI
- Runs 24/7 with zero hosting cost (GitHub Pages / Netlify)
- Includes an AI radio host with TTS voice announcements
- Auto-switches playlists based on time of day
- Supports manual LIVE hosting via microphone
- Has Festival Mode for Chhath and Wedding seasons

---

## 📁 Folder Structure

```
mithila-radio/
├── index.html       ← Main application
├── style.css        ← All styling (Madhubani dark theme)
├── script.js        ← Radio engine (player, scheduler, TTS)
├── config.json      ← ⭐ Edit this to customize everything
└── README.md        ← This file
```

---

## 🚀 Deploy in 5 Minutes (Free, Forever)

### Option A: Netlify (Recommended — Easiest)

1. Go to [netlify.com](https://netlify.com) → Sign up free
2. Click **"Add new site"** → **"Deploy manually"**
3. Drag and drop your `mithila-radio/` folder onto the page
4. Done! You get a URL like `https://mithilaradio.netlify.app`

To update: just drag-drop again or connect GitHub for auto-deploy.

### Option B: GitHub Pages

```bash
# 1. Create a GitHub repo (e.g. "mithila-radio")
# 2. Upload all 4 files to the repo root
# 3. Go to Settings → Pages → Source: main branch / root
# 4. Site live at: https://yourusername.github.io/mithila-radio
```

### Option C: Vercel

```bash
npm i -g vercel
cd mithila-radio
vercel
# Follow prompts — free forever on Hobby plan
```

---

## ⚙️ How to Configure (`config.json`)

### Add a New Playlist

Find the category in `config.json` and add to its `playlists` array:

```json
{
  "id": "PLxxxxxxxxxxxxxxxxxxxxxx",
  "title": "My Maithili Playlist",
  "source": "youtube"
}
```

**How to get a YouTube Playlist ID:**
1. Open any YouTube playlist
2. Copy the ID from the URL: `youtube.com/playlist?list=` **`PLxxxxxx`**

### Change Schedule Timings

Edit the `schedule` section:

```json
"morning": { "start": 5, "end": 11, "category": "bhajan", "label": "Pratah Bhajan" }
```

- `start` / `end` = 24-hour clock (5 = 5 AM, 20 = 8 PM)
- `category` = must match one of: `bhajan`, `folk`, `chhath`, `sohar`, `modern`

### Change AI Host Messages

Edit `announcements.messages` array in config.json:

```json
"messages": [
  "Aap sun rahe hain Mithila Radio…",
  "Hamara Mithila, hamari pehchaan…",
  "Jai Mithila! Suniye apni dharti ke geet."
]
```

### Change Announcement Frequency

```json
"announcements": { "intervalMinutes": 15 }
```

### Mock Listener Count

```json
"mockListeners": { "enabled": true, "base": 847, "variance": 200 }
```

---

## 🎧 Features Guide

### 1. AUTO Mode (Default)
Radio runs automatically:
- Selects playlist based on current time
- Auto-announces between songs
- Rotates playlists every 45 minutes

### 2. LIVE Mode
Toggle the AUTO/LIVE switch in top bar:
- AUTO playlist pauses
- Click "Start Mic" to broadcast your microphone
- Click "End Live" to return to AUTO mode

### 3. Festival Mode
Click festival buttons in right panel:
- **Chhath Parv**: Switches all music to Chhath geet
- **Vivah Season**: Switches to Sohar/Vivah music
- **Normal Mode**: Returns to schedule

### 4. Category Selection
Click any category button to instantly switch music:
- 🪷 Mithila Bhajan
- 🎵 Lok Geet  
- 🌅 Chhath Geet
- 🎊 Sohar & Vivah
- 🎸 Modern Maithili

---

## 🔊 AI Radio Host

Uses **Browser Web Speech API** (free, no API key needed):
- Hindi/Maithili voice announcements between songs
- Auto-detects Hindi voice from user's device
- Works on: Chrome, Edge, Safari (mobile + desktop)
- Firefox: visual announcement shown, voice may vary

To upgrade to better TTS (optional):
- Google Cloud TTS: Replace `triggerAnnouncement()` in script.js
- ElevenLabs: Great for custom Maithili/Hindi voice

---

## 📻 Curated Playlist IDs

These are real YouTube Maithili playlist IDs (verify & update periodically):

| Category | Description | Playlist ID |
|----------|-------------|-------------|
| Bhajan | Mithila Bhajan Collection | PLbMFMNKwTBqSrb-KFVzS-MFSx6THQZAMD |
| Bhajan | Sharda Sinha Bhajan | PLf4gA4AGplBn_r-AQ00K6wLsklCx_NSFM |
| Folk | Maithili Folk Songs | PLRBp0Fe2GpglK2eFXGfZbGvJHgOHagjqP |
| Chhath | Chhath Puja Songs | PLbMFMNKwTBqQMRMLM5sMVMmJ0Xu-qxQfm |
| Sohar | Maithili Sohar Geet | PLbMFMNKwTBqSFJ7ypbTZ8v6U3fPxnJFtM |
| Modern | New Maithili Songs | PLbMFMNKwTBqRF5Z2HiGxj_H3J_8fZ8YYb |

> **Tip**: Search YouTube for "Maithili Bhajan playlist", "Sharda Sinha Maithili", "Chhath Geet 2024" and add fresh playlists regularly.

---

## ⚖️ Legal Compliance

- ✅ Uses only YouTube embedded player (IFrame API)
- ✅ No audio files downloaded or hosted
- ✅ Complies with YouTube Terms of Service
- ✅ No copyright violation — YouTube handles all rights
- ✅ Only use public playlists marked for embedding

---

## 🛠️ Customization Tips

### Change Station Name
In `config.json`:
```json
"station": { "name": "Apna Radio", "tagline": "Apni Sanskriti" }
```

### Change Color Scheme
In `style.css`, update CSS variables at top:
```css
--gold: #f59e0b;   /* main accent */
--saffron: #fb923c; /* secondary */
--lotus: #f472b6;   /* announcements */
```

### Add WhatsApp Group Link
```json
"whatsapp": "https://wa.me/?text=Sun+Mithila+Radio..."
```

---

## 📱 Mobile Support

Fully responsive. On mobile:
- Player controls adapt to smaller screen
- Category grid shown in 3 columns
- Waveform animation optimized

**Note**: iOS Safari may require user interaction before audio plays. The play button handles this.

---

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| No audio plays | Click the play button once (browser autoplay policy) |
| "Video unavailable" error | Playlist is region-locked — replace with new playlist ID |
| Voice announcement not working | Chrome/Edge work best; Firefox may need update |
| Mic not working in LIVE mode | Allow microphone permission in browser |
| Blank page | Check browser console; likely config.json path issue |

---

## 🤝 Contributing

To add new Maithili playlists to the community collection:
1. Find a public YouTube Maithili playlist
2. Add the ID to appropriate category in `config.json`
3. Test that it plays
4. Share with the community

---

## 💛 Jai Mithila

*Made with love for the people of Mithila — Madhubani, Darbhanga, Sitamarhi, Muzaffarpur, Saharsa, and beyond.*

*मिथिला की माटी से… सदा के लिए मुफ्त।*

---

**License**: MIT — Free to use, fork, and deploy forever.
