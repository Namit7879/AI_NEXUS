import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { event, schedule } from './data.js';
import { loadSnapshot, saveSnapshot } from './persistence.js';
import { awardPoints, broadcast, getState, initializeState, subscribeClient, updateScore } from './state.js';
import {
  createGame,
  getGames,
  initializeGames,
  reviewGameSubmission,
  setGameEntryStatus,
  submitGameEntry
} from './games.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envPaths) {
  dotenv.config({ path: envPath, override: false });
}

const port = Number(process.env.PORT ?? 4000);
const clientDistPath = path.resolve(__dirname, '../../client/dist');
const uploadsDirPath = path.resolve(__dirname, '../uploads');
const persistedSnapshot = loadSnapshot();

fs.mkdirSync(uploadsDirPath, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (request, file, callback) => {
      callback(null, uploadsDirPath);
    },
    filename: (request, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      callback(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`);
    }
  }),
  fileFilter: (request, file, callback) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      callback(null, true);
      return;
    }

    callback(new Error('Only image uploads are allowed'));
  },
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

let editableEvent = {
  ...event,
  ...persistedSnapshot.event,
  tracks: [...persistedSnapshot.event.tracks],
  contacts: persistedSnapshot.event.contacts.map((contact) => ({ ...contact })),
  photos: Array.isArray(persistedSnapshot.event.photos)
    ? persistedSnapshot.event.photos.map((photo) => ({ ...photo }))
    : []
};

let editableJudges = persistedSnapshot.judges.map((judge) => ({
  name: normalizeText(judge?.name),
  companyName: normalizeText(judge?.companyName),
  photoUrl: normalizeText(judge?.photoUrl)
}));

initializeState(persistedSnapshot.teams);
initializeGames(persistedSnapshot.games);

const adminUsername = String(process.env.ADMIN_USERNAME ?? '').trim();
const adminPassword = String(process.env.ADMIN_PASSWORD ?? '').trim();
const adminSessions = new Map();

if (!adminUsername || !adminPassword) {
  console.warn('Admin credentials are missing. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env.');
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeTracks(input) {
  if (!Array.isArray(input)) {
    throw new Error('tracks must be an array');
  }

  const normalized = input.map((track) => normalizeText(track)).filter(Boolean);

  if (normalized.length === 0) {
    throw new Error('at least one track is required');
  }

  return normalized;
}

function normalizeContacts(input) {
  if (!Array.isArray(input)) {
    throw new Error('contacts must be an array');
  }

  const normalized = input
    .map((contact) => ({
      name: normalizeText(contact?.name),
      phone: normalizeText(contact?.phone),
      label: normalizeText(contact?.label)
    }))
    .filter((contact) => contact.name && contact.phone && contact.label);

  if (normalized.length === 0) {
    throw new Error('at least one contact with name, phone and label is required');
  }

  return normalized;
}

function normalizeJudges(input) {
  if (!Array.isArray(input)) {
    throw new Error('judges must be an array');
  }

  const normalized = input
    .map((judge) => {
      const name = normalizeText(judge?.name);
      const companyName = normalizeText(judge?.companyName);
      const photoUrl = normalizeText(judge?.photoUrl);

      return { name, companyName, photoUrl };
    })
    .filter((judge) => judge.name);

  return normalized;
}

function normalizePhotos(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((photo) => ({
      imageUrl: normalizeText(photo?.imageUrl),
      caption: normalizeText(photo?.caption)
    }))
    .filter((photo) => photo.imageUrl);
}

function extractBearerToken(request) {
  const authorization = request.headers.authorization ?? '';

  if (!authorization.startsWith('Bearer ')) {
    return '';
  }

  return authorization.slice('Bearer '.length).trim();
}

function authenticateAdmin(request, response, next) {
  const token = extractBearerToken(request);

  if (!token || !adminSessions.has(token)) {
    response.status(401).json({ error: 'Unauthorized admin access' });
    return;
  }

  request.adminUser = adminSessions.get(token);
  next();
}

function buildAppState() {
  return {
    ...getState(),
    games: getGames()
  };
}

function commitAppState() {
  const state = buildAppState();

  saveSnapshot({
    event: editableEvent,
    judges: editableJudges,
    teams: state.teams,
    games: state.games
  });

  broadcast(state);
  return state;
}

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDirPath));
app.use('/api/uploads', express.static(uploadsDirPath));

app.get('/api/event', (request, response) => {
  response.json(editableEvent);
});

app.get('/api/judges', (request, response) => {
  response.json({ judges: editableJudges });
});

app.get('/api/schedule', (request, response) => {
  response.json({ schedule });
});

app.get('/api/leaderboard', (request, response) => {
  response.json(getState());
});

app.get('/api/games', (request, response) => {
  response.json({ games: getGames() });
});

app.post('/api/admin/login', (request, response) => {
  if (!adminUsername || !adminPassword) {
    response.status(500).json({ error: 'Admin credentials are not configured on server' });
    return;
  }

  const username = normalizeText(request.body?.username);
  const password = normalizeText(request.body?.password);

  if (username !== adminUsername || password !== adminPassword) {
    response.status(401).json({ error: 'Invalid admin credentials' });
    return;
  }

  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, username);

  response.json({ token, username });
});

app.get('/api/admin/session', authenticateAdmin, (request, response) => {
  response.json({ authenticated: true, username: request.adminUser });
});

app.post('/api/admin/logout', authenticateAdmin, (request, response) => {
  const token = extractBearerToken(request);
  adminSessions.delete(token);
  response.status(204).send();
});

app.put('/api/admin/content', authenticateAdmin, (request, response) => {
  const { tracks, contacts, photos, judges: incomingJudges } = request.body ?? {};

  try {
    const normalizedTracks = normalizeTracks(tracks);
    const normalizedContacts = normalizeContacts(contacts);
    const normalizedPhotos = normalizePhotos(photos);
    const normalizedJudges = normalizeJudges(incomingJudges);

    editableEvent = {
      ...editableEvent,
      tracks: normalizedTracks,
      contacts: normalizedContacts,
      photos: normalizedPhotos
    };
    editableJudges = normalizedJudges;
    commitAppState();

    response.json({ event: editableEvent, judges: editableJudges });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/photos/upload', authenticateAdmin, (request, response) => {
  upload.single('photo')(request, response, (error) => {
    if (error) {
      response.status(400).json({ error: error.message || 'Upload failed' });
      return;
    }

    if (!request.file) {
      response.status(400).json({ error: 'photo file is required' });
      return;
    }

    response.json({
      imageUrl: `/api/uploads/${request.file.filename}`
    });
  });
});

app.post('/api/admin/judges/upload', authenticateAdmin, (request, response) => {
  upload.single('photo')(request, response, (error) => {
    if (error) {
      response.status(400).json({ error: error.message || 'Upload failed' });
      return;
    }

    if (!request.file) {
      response.status(400).json({ error: 'photo file is required' });
      return;
    }

    response.json({
      photoUrl: `/api/uploads/${request.file.filename}`
    });
  });
});

app.post('/api/admin/games', authenticateAdmin, (request, response) => {
  try {
    createGame(request.body);
    const state = commitAppState();
    response.json(state);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch('/api/admin/games/:gameId', authenticateAdmin, (request, response) => {
  try {
    const { gameId } = request.params;
    const acceptingEntries = Boolean(request.body?.acceptingEntries);

    setGameEntryStatus(gameId, acceptingEntries);
    const state = commitAppState();
    response.json(state);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post('/api/games/:gameId/entries', (request, response) => {
  const { gameId } = request.params;
  const { teamId, entry } = request.body ?? {};
  const team = getState().teams.find((entryTeam) => entryTeam.id === teamId);

  if (!teamId || !team || !String(entry ?? '').trim()) {
    response.status(400).json({ error: 'teamId and entry are required' });
    return;
  }

  try {
    submitGameEntry(
      {
        gameId,
        teamId,
        teamName: team.name,
        college: team.college,
        entry
      }
    );

    const state = commitAppState();
    response.json(state);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch('/api/admin/games/:gameId/submissions/:submissionId', authenticateAdmin, (request, response) => {
  try {
    const { gameId, submissionId } = request.params;
    const decision = normalizeText(request.body?.decision).toLowerCase();

    reviewGameSubmission({ gameId, submissionId, decision }, awardPoints);
    const state = commitAppState();
    response.json(state);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get('/api/stream', (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  subscribeClient(response);
  response.write(`data: ${JSON.stringify(buildAppState())}\n\n`);
});

app.post('/api/rounds/:roundId/scores', (request, response) => {
  const { roundId } = request.params;
  const { teamId, score } = request.body;
  const parsedScore = Number(score);

  if (!teamId || !Number.isFinite(parsedScore)) {
    response.status(400).json({ error: 'teamId and score are required' });
    return;
  }

  try {
    const state = updateScore(teamId, roundId, parsedScore);
    commitAppState();
    response.json(buildAppState());
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.use(express.static(clientDistPath));

app.get('*', (request, response, next) => {
  if (request.path.startsWith('/api')) {
    next();
    return;
  }

  response.sendFile(path.join(clientDistPath, 'index.html'), (error) => {
    if (error) {
      next();
    }
  });
});

app.listen(port, () => {
  const state = buildAppState();
  broadcast(state);
  console.log(`AI NEXUS server running on http://localhost:${port}`);
});