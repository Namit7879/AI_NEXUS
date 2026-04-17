import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { event, judges, teams } from './data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirPath = path.resolve(__dirname, '../data');
const dataFilePath = path.join(dataDirPath, 'runtime-data.json');

function cloneEvent(input) {
  return {
    ...input,
    tracks: Array.isArray(input?.tracks) ? [...input.tracks] : [],
    contacts: Array.isArray(input?.contacts)
      ? input.contacts.map((contact) => ({ ...contact }))
      : [],
    photos: Array.isArray(input?.photos)
      ? input.photos.map((photo) => ({ ...photo }))
      : []
  };
}

function cloneJudges(input) {
  return Array.isArray(input)
    ? input.map((judge) => ({
      name: String(judge?.name ?? '').trim(),
      companyName: String(judge?.companyName ?? '').trim(),
      photoUrl: String(judge?.photoUrl ?? '').trim()
    }))
    : [];
}

function cloneTeams(input) {
  return Array.isArray(input)
    ? input.map((team) => ({
      ...team,
      members: Array.isArray(team?.members) ? [...team.members] : [],
      bonusPoints: Number(team?.bonusPoints) || 0,
      scores: { ...(team?.scores ?? {}) }
    }))
    : [];
}

function cloneGames(input) {
  return Array.isArray(input)
    ? input.map((game) => ({
      ...game,
      title: String(game?.title ?? '').trim(),
      description: String(game?.description ?? '').trim(),
      entryLabel: String(game?.entryLabel ?? '').trim() || 'Submission',
      deadline: String(game?.deadline ?? '').trim(),
      rewardPoints: Number(game?.rewardPoints) || 0,
      acceptingEntries: Boolean(game?.acceptingEntries),
      submissions: Array.isArray(game?.submissions)
        ? game.submissions.map((submission) => ({ ...submission }))
        : []
    }))
    : [];
}

function createDefaultSnapshot() {
  return {
    event: cloneEvent(event),
    judges: cloneJudges(judges),
    teams: cloneTeams(teams),
    games: []
  };
}

function ensureDataDir() {
  fs.mkdirSync(dataDirPath, { recursive: true });
}

function normalizeSnapshot(parsedSnapshot) {
  const defaults = createDefaultSnapshot();

  return {
    event: parsedSnapshot?.event ? cloneEvent(parsedSnapshot.event) : defaults.event,
    judges:
      Array.isArray(parsedSnapshot?.judges) && parsedSnapshot.judges.length > 0
        ? cloneJudges(parsedSnapshot.judges)
        : defaults.judges,
    teams:
      Array.isArray(parsedSnapshot?.teams) && parsedSnapshot.teams.length > 0
        ? cloneTeams(parsedSnapshot.teams)
        : defaults.teams,
    games:
      Array.isArray(parsedSnapshot?.games) && parsedSnapshot.games.length > 0
        ? cloneGames(parsedSnapshot.games)
        : defaults.games
  };
}

export function loadSnapshot() {
  ensureDataDir();

  if (!fs.existsSync(dataFilePath)) {
    const defaults = createDefaultSnapshot();
    fs.writeFileSync(dataFilePath, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
    return defaults;
  }

  try {
    const fileContents = fs.readFileSync(dataFilePath, 'utf8');
    const parsed = JSON.parse(fileContents);
    return normalizeSnapshot(parsed);
  } catch {
    const defaults = createDefaultSnapshot();
    fs.writeFileSync(dataFilePath, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
    return defaults;
  }
}

export function saveSnapshot(snapshot) {
  ensureDataDir();
  const normalized = normalizeSnapshot(snapshot);
  fs.writeFileSync(dataFilePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}
