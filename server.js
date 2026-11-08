import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const app = express();
app.use(express.json());
const {
  PORT = 3000, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
  APP_ACCESS_CODE, ROOM_NAME = 'alfa-quebec', MAX_USERS = '10'
} = process.env;

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !APP_ACCESS_CODE) {
  throw new Error('Configura LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET e APP_ACCESS_CODE');
}
const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const maxUsers = Number(MAX_USERS);
let holder = null;
let expiresAt = 0;
const LOCK_MS = 12000;

function expireLock() {
  if (holder && Date.now() > expiresAt) holder = null;
}
app.get('/health', (_req, res) => res.json({ ok: true, service: 'ALFA QUEBEC VOICE' }));

app.post('/token', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 32);
    const code = String(req.body.accessCode || '');
    if (!name) return res.status(400).json({ error: 'Inserisci il nominativo' });
    if (code !== APP_ACCESS_CODE) return res.status(403).json({ error: 'Codice di accesso non valido' });

    let participants = [];
    try {
      participants = await roomService.listParticipants(ROOM_NAME);
    } catch (e) {
      if (e.code !== 'not_found' && e.status !== 404) throw e;
    }
    if (participants.length >= maxUsers) return res.status(409).json({ error: 'Canale pieno: massimo 10 utenti' });

    const identity = crypto.randomUUID();
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity, name, ttl: '15m'
    });
    at.addGrant({ roomJoin: true, room: ROOM_NAME, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();
    res.json({ identity, token, serverUrl: LIVEKIT_URL, room: ROOM_NAME });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Impossibile generare il collegamento' });
  }
});

app.get('/status', async (_req, res) => {
  try {
    expireLock();
    const participants = await roomService.listParticipants(ROOM_NAME);
    res.json({ users: participants.length, speaker: holder?.name || 'Canale libero' });
  } catch {
    res.status(503).json({ error: 'Stato canale non disponibile' });
  }
});

app.post('/ptt/acquire', (req, res) => {
  expireLock();
  const { identity } = req.body;
  if (!identity) return res.status(400).json({ error: 'Identità mancante' });
  if (holder && holder.identity !== identity) {
    return res.json({ granted: false, speaker: holder.name });
  }
  holder = { identity, name: String(req.body.name || 'Utente') };
  expiresAt = Date.now() + LOCK_MS;
  res.json({ granted: true });
});

app.post('/ptt/heartbeat', (req, res) => {
  expireLock();
  if (!holder || holder.identity !== req.body.identity) {
    return res.status(409).json({ error: 'Permesso di parola scaduto' });
  }
  expiresAt = Date.now() + LOCK_MS;
  res.json({ ok: true });
});

app.post('/ptt/release', (req, res) => {
  if (holder && holder.identity === req.body.identity) holder = null;
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`ALFA QUEBEC VOICE backend attivo sulla porta ${PORT}`));
