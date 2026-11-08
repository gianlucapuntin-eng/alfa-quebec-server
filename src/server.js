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

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.json({ ok: true }));

app.post('/token', async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || body.nome || body.Nome || body.nominativo || body.Nominativo || body.identity || body.Identity || body.username || '').trim();
    const code = String(body.accessCode || body.accessCodice || body.code || body.codice || body.Codice || '').trim();
    console.log('Richiesta token:', { name, code, body });
    if (!name) return res.status(400).json({ error: 'No value for identity - Nome mancante' });
    if (code !== APP_ACCESS_CODE) return res.status(401).json({ error: 'Codice non valido' });

    let participants = [];
    try { participants = await roomService.listParticipants(ROOM_NAME); } catch (e) { if (e.code !== 'not_found' && e.status !== 404) throw e; }
    if (participants.length >= MAX_USERS) return res.status(409).json({ error: 'Canale pieno' });

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: name, name: name, ttl: '2h' });
    at.addGrant({ roomJoin: true, room: ROOM_NAME, canPublish: true, canSubscribe: true, canPublishData: true });
    const token = await at.toJwt();
    console.log('Token creato per', name, 'lunghezza', token.length);
    return res.json({ token, serverUrl: LIVEKIT_URL, room: ROOM_NAME, identity: name });
  } catch (e) {
    console.error('Errore /token', e);
    return res.status(500).json({ error: 'Impossibile generare il collegamento: ' + e.message });
  }
});

app.get('/status', async (req, res) => {
  try {
    let participants = [];
    try { participants = await roomService.listParticipants(ROOM_NAME); } catch {}
    return res.json({ users: participants.length, maxUsers: MAX_USERS });
  } catch { return res.json({ users: 0, maxUsers: MAX_USERS }); }
});

app.listen(PORT, () => console.log('Server in ascolto su ' + PORT));

