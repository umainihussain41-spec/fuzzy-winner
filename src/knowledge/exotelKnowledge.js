/**
 * Exotel Built-in Knowledge Base
 * Comprehensive knowledge about Exotel products, APIs, and support.
 * This is injected into every LLM system prompt.
 */

const EXOTEL_KNOWLEDGE = `
## ABOUT EXOTEL
Exotel is India's leading cloud telephony and CPaaS (Communications Platform as a Service) company. Founded in 2011, headquartered in Bangalore, India. It powers communication for 6000+ businesses including Ola, Swiggy, Dunzo, Urban Company, and many banks, NBFCs, and healthcare companies.

**Website:** https://exotel.com  
**Support Center:** https://support.exotel.com  
**Developer Portal:** https://developer.exotel.com  
**Dashboard:** https://my.exotel.com  
**Support Email:** hello@exotel.in  
**Support Phone:** +91-8088919888 / 08088919888  
**WhatsApp Support:** 08088919888  

---

## CORE PRODUCTS

### 1. Cloud Telephony / ExoPhone
- Virtual phone numbers (Exophones) that route calls intelligently
- Types: Local numbers (10-digit), Toll-free numbers (1800-xxx), Short codes
- Supports PSTN, SIP, and VoIP calls
- Number masking: Hide real customer/agent numbers for privacy
- Multi-level IVR (Interactive Voice Response) builder via App Bazaar

### 2. Smart IVR
- Drag-and-drop IVR builder — no coding required
- Supports: Play message, Record, Gather DTMF input, Transfer, Voicemail
- Multilingual IVR (Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, etc.)
- Real-time call routing based on business hours, agent availability, DTMF input

### 3. Click-to-Call
- API to initiate outbound calls between two parties
- Agent clicks in CRM → Exotel bridges the call
- Hides agent's personal number from customer
- API: POST /v1/Accounts/{sid}/Calls/connect

### 4. ExoVoice (Voice Bot / Conversational IVR)
- AI-powered voice bot for automated customer conversations
- Understands natural language (not just DTMF)
- Integrates with third-party STT/TTS providers
- AgentStream: bidirectional WebSocket for custom voicebot integration

### 5. Exotel Contact Center (Exotel CC)
- Full-featured cloud contact center
- Features: ACD (Automatic Call Distribution), skills-based routing, call queuing
- Real-time dashboards, supervisor monitoring, agent screen
- CRM integrations: Salesforce, Freshdesk, Zoho, HubSpot, Leadsquared
- Live call monitoring and call barging

### 6. SMS / WhatsApp Messaging
- Transactional and promotional SMS via Exotel SMS API
- WhatsApp Business API integration
- Two-way messaging workflows
- OTP delivery, notifications, reminders

### 7. ExoRecorder
- Automatic call recording (inbound and outbound)
- Dual-channel recording (separate tracks for agent and customer)
- Secure cloud storage with configurable retention
- Recording playback via dashboard or API download

### 8. ExoVoice Analyze (ExoAnalyze)
- Post-call AI analytics: transcription, sentiment analysis, call summary
- Tracks keywords, compliance phrases, objection handling
- API: POST /v1/Accounts/{sid}/Voice/Analyze
- Async — sends result to a callback URL when complete
- Supports 10+ Indian languages

### 9. Number Masking
- Mask real phone numbers between two parties (e.g., driver ↔ customer)
- Both parties call a virtual Exophone — real numbers never exposed
- Session-based with configurable timeout

---

## APIS & DEVELOPER DOCS

### Authentication
- All APIs use HTTP Basic Auth
- **Username:** API Key (from my.exotel.com → Settings → API)
- **Password:** API Token
- **India Base URL:** https://api.in.exotel.com/v1/Accounts/{account_sid}/
- **Singapore Base URL:** https://api.exotel.com/v1/Accounts/{account_sid}/

### Key API Endpoints

#### Calls API
- **Initiate outbound call:** POST /v1/Accounts/{sid}/Calls/connect
  - Params: From, To, CallerId (Exophone), Url (App URL or StreamUrl for voicebot), StatusCallback
- **Get call details:** GET /v1/Accounts/{sid}/Calls/{CallSid}
- **List calls:** GET /v1/Accounts/{sid}/Calls
- **Active calls:** GET /v1/Accounts/{sid}/Calls/active (Voice v3 Beta)

#### SMS API
- **Send SMS:** POST /v1/Accounts/{sid}/Sms/send
  - Params: From (ExoPhone), To, Body, StatusCallback
- **Get SMS:** GET /v1/Accounts/{sid}/Sms/{SmsSid}

#### AgentStream (Voicebot Streaming)
- **Connect to stream:** POST /v1/Accounts/{sid}/Calls/connect
  - Params: StreamUrl (wss:// endpoint), StreamType: bidirectional
- **Audio format:** PCM 16kHz (or µ-law 8kHz), mono
- **Chunk size:** 160–3200 bytes (recommended: 320 bytes = 20ms at 16kHz)
- **Events received:** connected, start, media, dtmf, mark, clear, stop
- **Events sent:** media (audio chunks), mark, clear

#### Exotel App Bazaar Applets
- **Voicebot Applet:** Configure WebSocket URL for AI bot integration
- **Stream Applet:** Unidirectional audio streaming for transcription
- **Record Applet:** Record call legs separately
- **Passthru Applet:** Forward call to external URL for dynamic IVR logic

### Webhooks / Status Callbacks
- Exotel sends HTTP POST to your StatusCallback URL on call events
- Events: initiated, ringing, answered, completed, busy, no-answer, failed
- VoiceBot events: session_start, session_end, transcript_events

---

## EXOTEL APP BAZAAR
App Bazaar is Exotel's app marketplace for call flow building.
- **IVR:** Multi-level interactive voice menus
- **Record:** Record calls, voicemail
- **Transcribe:** Real-time and async transcription
- **Voicebot:** Connect to custom AI bot via WebSocket
- **Agent Connect:** Route to available agent
- **Time-based routing:** Route by business hours
- **Blacklist:** Block specific numbers

---

## BILLING & PLANS
- **Starter Plan:** ₹1,999/month — up to 2,000 minutes, 2 Exophones
- **Growth Plan:** ₹4,999/month — up to 5,000 minutes, 5 Exophones
- **Enterprise Plan:** Custom pricing — unlimited minutes, dedicated support
- **Pay-per-use rates:**
  - Inbound calls: ₹0.12–₹0.35/min depending on plan
  - Outbound calls: ₹0.30–₹0.60/min
  - SMS: ₹0.16–₹0.20 per message
- Free trial available (no credit card required for signup)
- All plans include: dashboard access, API access, call recording (limited)

---

## INTEGRATIONS
- CRM: Salesforce, HubSpot, Zoho CRM, Freshdesk, Leadsquared, Kapture
- Helpdesk: Freshservice, Zendesk
- Databases: Direct webhook/API-based integrations
- Custom: REST API + Webhooks support all custom integrations

---

## COMMON TROUBLESHOOTING

### Call Not Connecting
1. Check Exophone is active (my.exotel.com → Phone Numbers)
2. Verify API credentials (API Key + Token are correct)
3. Check "From" number is your registered Exophone
4. Ensure DND compliance for promotional calls
5. Check account balance is not zero

### IVR Not Playing Audio
1. Audio file must be MP3 or WAV (8kHz, 16-bit, mono) for best compatibility
2. File must be publicly accessible URL (not localhost)
3. Check App Bazaar applet URL is correct and returns valid TwiML/ExoML

### API Returning 401
- API Key or Token is wrong
- Account SID doesn't match credentials
- Try regenerating token from my.exotel.com → Settings → API

### API Returning 400
- Missing required parameters (check From, To, CallerId fields)
- Phone number format: use +91XXXXXXXXXX (E.164) or 0XXXXXXXXXX

### Recording Not Available
- Ensure Record applet is placed in call flow before bridging
- Check storage retention settings (default 60 days)
- Download via API: GET /v1/Accounts/{sid}/Calls/{CallSid}/Recordings

### Number Masking Not Working
- Session must be active (check session timeout setting)
- Both numbers must be valid Indian mobile numbers
- Exophone must have masking feature enabled (contact support)

---

## EXOTEL TEAM & CONTACT
- **Headquarters:** Bangalore, India
- **Founded:** 2011
- **CEO:** Shivakumar Ganesan
- **Support Hours:** Mon–Sat, 9 AM – 6 PM IST
- **Emergency escalation:** Available for Enterprise plan customers 24/7
- **Sales:** sales@exotel.in
- **Developer Community:** https://community.exotel.com

---

## USEFUL LINKS
- API Documentation: https://developer.exotel.com
- Support Center: https://support.exotel.com
- Status Page: https://status.exotel.com
- App Bazaar: https://my.exotel.com/app-bazaar
- Dashboard: https://my.exotel.com
- Blog/Resources: https://exotel.com/blog
- Changelog: https://exotel.com/changelog
`;

module.exports = { EXOTEL_KNOWLEDGE };
