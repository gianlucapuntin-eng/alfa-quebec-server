import express from 'express';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const APP_ACCESS_CODE = process.env.APP_ACCESS_CODE || 'ALFA2026';
const ROOM_NAME = process.env.ROOM_NAME || 'alfa-quebec';
const MAX_USERS = parseInt(process.env.MAX_USERS || '10', 10);

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

let currentSpeaker = null;
let speakerTimeout = null;

app.get('/health', (req, res) => res.json({ ok: true, room: ROOM_NAME }));
app.get('/', (req, res) => res.json({ ok: true, service: 'alfa-quebec-server' }));

app.post('/token', async (req, res) => {
  try {
    const name = String(req.body?.name || req.body?.nominativo || req.body?.identity || req.body?.username || '').trim();
    const code = String(req.body?.accessCode || req.body?.code || req.body?.codice || '').trim();
    console.log('Token request:', name, code);
    if (!name) return res.status(400).json({ error: 'Nome mancante' });
    if (code !== APP_ACCESS_CODE) return res.status(401).json({ error: 'Codice non valido' });
    let participants = [];
    try { participants = await roomService.listParticipants(ROOM_NAME); } catch (e) { if (e.code !== 'not_found' && e.status !== 404) throw e; }
    if (participants.length >= MAX_USERS) return res.status(409).json({ error: 'Canale pieno' });
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: name, name: name, ttl: '2h' });
    at.addGrant({ roomJoin: true, room: ROOM_NAME, canPublish: true, canSubscribe: true, canPublishData: true });
    const token = await at.toJwt();
    console.log('Token OK per', name);
    return res.json({ token, serverUrl: LIVEKIT_URL, room: ROOM_NAME });
  } catch (e) {
    console.error('Errore /token', e);
    return res.status(500).json({ error: 'Impossibile generare il collegamento' });
  }
});

app.get('/status', async (req, res) => {
  try {
    let participants = [];
    try { participants = await roomService.listParticipants(ROOM_NAME); } catch (e) { if (e.code !== 'not_found' && e.status !== 404) throw e; }
    return res.json({ users: participants.length, maxUsers: MAX_USERS, speaker: currentSpeaker || 'Canale libero', participants: participants.map(p=>p.identity) });
  } catch { return res.json({ users: 0, maxUsers: MAX_USERS, speaker: currentSpeaker || 'Canale libero' }); }
});

// --- PTT ENDPOINTS PER TELEFONO (questi mancavano!) ---
app.post('/ptt/acquire', (req, res) => {
  const identity = String(req.body?.identity || req.body?.name || req.body?.nominativo || '').trim();
  console.log('PTT acquire:', identity, 'current:', currentSpeaker);
  if (!identity) return res.json({ granted: false, reason: 'no identity' });
  if (currentSpeaker && currentSpeaker !== identity) {
    return res.json({ granted: false, reason: 'occupied', speaker: currentSpeaker });
  }
  currentSpeaker = identity;
  if (speakerTimeout) clearTimeout(speakerTimeout);
  speakerTimeout = setTimeout(() => { currentSpeaker = null; console.log('PTT timeout, libero'); }, 20000);
  return res.json({ granted: true, speaker: currentSpeaker });
});

app.post('/ptt/heartbeat', (req, res) => {
  const identity = String(req.body?.identity || req.body?.name || '').trim();
  if (currentSpeaker === identity) {
    if (speakerTimeout) clearTimeout(speakerTimeout);
    speakerTimeout = setTimeout(() => { currentSpeaker = null; }, 20000);
  }
  return res.json({ ok: true, speaker: currentSpeaker });
});

app.post('/ptt/release', (req, res) => {
  const identity = String(req.body?.identity || req.body?.name || '').trim();
  console.log('PTT release:', identity);
  if (currentSpeaker === identity) {
    currentSpeaker = null;
    if (speakerTimeout) clearTimeout(speakerTimeout);
  }
  return res.json({ ok: true, speaker: currentSpeaker || 'Canale libero' });
});

app.listen(PORT, () => console.log('Server in ascolto su ' + PORT + ' room ' + ROOM_NAME));
