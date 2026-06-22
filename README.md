# 🤖 Asha — Exotel Internal VoiceBot

An AI-powered phone support bot for Exotel internal teams. Answers questions about Exotel products, APIs, troubleshooting, and billing — with a natural Indian English accent.

## ✨ Features

| Feature | Technology |
|---|---|
| 📞 Telephony | Exotel AgentStream (bidirectional WebSocket) |
| 🎤 Speech-to-Text | Sarvam AI `saarika:v2` — Indian accent |
| 🧠 LLM Brain | Groq `llama-3.3-70b-versatile` — free tier |
| 🔊 Text-to-Speech | Sarvam AI `bulbul:v3` — Indian English `en-IN` |
| 📖 Knowledge | Built-in Exotel KB + live scraper fallback |
| 🖥️ Dashboard | Real-time admin panel with live transcripts |

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+ (`node --version`)
- npm 9+
- [ngrok](https://ngrok.com) for local dev (or any tunnel/VPS)

### 2. Get Free API Keys

| Service | URL | Cost |
|---|---|---|
| **Groq** (LLM) | https://console.groq.com | 100% free, no CC |
| **Sarvam AI** (STT+TTS) | https://dashboard.sarvam.ai | Free trial credits |
| **Exotel** | https://my.exotel.com | Your existing account |

### 3. Install & Configure

```bash
cd "New VoiceBot"
npm install

# Copy the env template
copy .env.example .env
# Then edit .env with your actual API keys
```

### 4. Start the Server

```bash
npm start
# Server starts on http://localhost:3000
```

### 5. Expose with ngrok (local dev)

```bash
ngrok http 3000
# Copy the https URL, e.g.: https://abc123.ngrok.io
# Your WebSocket URL will be: wss://abc123.ngrok.io/stream
```

Update `PUBLIC_WS_URL=wss://abc123.ngrok.io` in your `.env`.

### 6. Configure Exotel

1. Log in to [my.exotel.com](https://my.exotel.com)
2. Go to **App Bazaar** → Create/Edit an app
3. Add a **Voicebot Applet**
4. Set **Stream URL** to: `wss://abc123.ngrok.io/stream`
5. Set **Stream Type** to: `bidirectional`
6. Assign the app to your Exophone (virtual number)

### 7. Call the Number! 📞

Call your Exophone. Asha (the bot) will answer and help with any Exotel question.

---

## 📊 Admin Dashboard

Open `http://localhost:3000/dashboard.html` in your browser to see:
- 🟢 Active calls
- 💬 Live transcripts (real-time)
- ⚡ Event stream
- 🔍 Web scraper usage tracking

---

## 🧠 How It Works

```
Caller speaks
     │
     ▼
Exotel AgentStream (WebSocket)
     │  PCM audio chunks
     ▼
VAD (Voice Activity Detection)
     │  Buffers until 700ms silence
     ▼
Sarvam saarika:v2 STT
     │  Transcript text
     ▼
Groq llama-3.3-70b LLM
     │  (with full Exotel knowledge base in system prompt)
     │  If bot says SEARCH_NEEDED:...
     ▼
Web Scraper → support.exotel.com / developer.exotel.com
     │  Scraped content re-injected into LLM
     ▼
Sarvam bulbul:v3 TTS (en-IN, Indian accent)
     │  PCM audio chunks
     ▼
Exotel AgentStream (sent back to caller)
```

---

## ⚙️ Configuration

All config lives in `.env`:

```env
# Exotel
EXOTEL_ACCOUNT_SID=your_account_sid
EXOTEL_API_KEY=your_api_key
EXOTEL_API_TOKEN=your_api_token
EXOTEL_CALLER_ID=+91XXXXXXXXXX

# Groq (free)
GROQ_API_KEY=gsk_...

# Sarvam (free credits)
SARVAM_API_KEY=...

# Bot behaviour
SARVAM_SPEAKER=anushka    # Indian English female voice
SARVAM_LANGUAGE=en-IN
VAD_SILENCE_MS=700        # Wait 700ms after speech stops
```

### Available Sarvam Voices
- Female: `anushka`, `manisha`, `vidya`
- Male: `arjun`, `abhilash`, `karun`, `hitesh`

---

## 🔧 Troubleshooting

### Bot not answering
- Check server is running (`npm start`)
- Verify ngrok URL is correct and matches `.env`
- Check Exotel App Bazaar has Voicebot applet with correct `wss://` URL

### STT returning empty
- Audio may be too short — increase `VAD_SILENCE_MS` to 900ms
- Check `SARVAM_API_KEY` is valid

### TTS not playing
- Check `SARVAM_API_KEY` is valid and has credits
- Try a different `SARVAM_SPEAKER` value

### LLM rate limited
- Groq free tier has limits — the bot auto-retries with backoff
- Consider upgrading Groq plan or reducing call volume

---

## 📁 Project Structure

```
New VoiceBot/
├── server.js                  # Entry point
├── package.json
├── .env                       # Your secrets (never commit this)
├── .env.example               # Template
├── src/
│   ├── websocket/
│   │   └── exotelHandler.js   # Exotel AgentStream handler + VAD
│   ├── stt/
│   │   └── sarvamSTT.js       # Sarvam saarika:v2 STT
│   ├── tts/
│   │   └── sarvamTTS.js       # Sarvam bulbul:v3 TTS
│   ├── llm/
│   │   └── groqLLM.js         # Groq Llama-3 LLM
│   ├── knowledge/
│   │   ├── exotelKnowledge.js # Built-in Exotel knowledge base
│   │   └── webScraper.js      # Live fallback scraper
│   ├── config/
│   │   └── systemPrompt.js    # LLM system prompt builder
│   └── pipeline.js            # STT → LLM → TTS orchestrator
└── public/
    ├── dashboard.html          # Admin dashboard
    └── dashboard.js            # Dashboard WS client
```

---

## 🛡️ Security Notes

- **Never commit `.env`** — it contains API keys
- The `/stream` WebSocket is open (no auth) — restrict to Exotel IPs in production
- Web scraper caches pages for 30 min to avoid overloading Exotel's portal

---

## 📞 Exotel Support

If the bot doesn't know something, it falls back to live content from:
- **Support Center:** https://support.exotel.com
- **Developer Docs:** https://developer.exotel.com
- **Email:** hello@exotel.in
- **Phone:** +91-8088919888
