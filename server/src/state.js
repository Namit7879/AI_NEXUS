import { rounds, teams } from './data.js';

const clients = new Set();

function calculateLeaderboard(currentTeams) {
  return currentTeams
    .map((team) => ({
      teamId: team.id,
      teamName: String(team.name ?? '').trim(),
      college: String(team.college ?? '').trim(),
      total:
        rounds.reduce((sum, round) => sum + (Number(team?.scores?.[round.id]) || 0), 0) +
        (Number(team.bonusPoints) || 0),
      roundScores: { ...(team?.scores ?? {}) }
    }))
    .sort(
      (left, right) =>
        right.total - left.total ||
        left.teamName.localeCompare(right.teamName)
    );
}

function cloneTeams(inputTeams) {
  return inputTeams.map((team) => ({
    ...team,
    name: String(team?.name ?? '').trim(),
    college: String(team?.college ?? '').trim(),
    members: Array.isArray(team.members) ? [...team.members] : [],
    bonusPoints: Number(team.bonusPoints) || 0,
    scores: { ...(team?.scores ?? {}) }
  }));
}

let currentTeams = cloneTeams(teams);

export function initializeState(initialTeams) {
  if (Array.isArray(initialTeams) && initialTeams.length > 0) {
    currentTeams = cloneTeams(initialTeams);
    return;
  }

  currentTeams = cloneTeams(teams);
}

export function getState() {
  return {
    teams: currentTeams,
    rounds,
    leaderboard: calculateLeaderboard(currentTeams)
  };
}

export function updateScore(teamId, roundId, score) {
  const team = currentTeams.find((entry) => entry.id === teamId);

  if (!team) {
    throw new Error('Team not found');
  }

  if (!rounds.some((round) => round.id === roundId)) {
    throw new Error('Round not found');
  }

  team.scores[roundId] = score;

  return getState();
}

export function awardPoints(teamId, points) {
  const team = currentTeams.find((entry) => entry.id === teamId);

  if (!team) {
    throw new Error('Team not found');
  }

  const awardedPoints = Number(points);

  if (!Number.isFinite(awardedPoints) || awardedPoints <= 0) {
    return getState();
  }

  team.bonusPoints = (Number(team.bonusPoints) || 0) + awardedPoints;
  return getState();
}

export function subscribeClient(res) {
  clients.add(res);

  res.on('close', () => {
    clients.delete(res);
  });
}

export function broadcast(payload) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;

  for (const client of clients) {
    client.write(message);
  }
}