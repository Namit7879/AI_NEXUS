import { randomUUID } from 'node:crypto';

let currentGames = [];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeRewardPoints(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
}

function cloneSubmission(submission) {
  return {
    ...submission
  };
}

function cloneGame(game) {
  return {
    ...game,
    title: normalizeText(game.title),
    description: normalizeText(game.description),
    entryLabel: normalizeText(game.entryLabel) || 'Submission',
    deadline: normalizeText(game.deadline),
    rewardPoints: normalizeRewardPoints(game.rewardPoints),
    acceptingEntries: Boolean(game.acceptingEntries),
    submissions: Array.isArray(game.submissions) ? game.submissions.map(cloneSubmission) : []
  };
}

function cloneGames(games) {
  return Array.isArray(games) ? games.map(cloneGame) : [];
}

function hasDeadlineExpired(deadline) {
  const parsedDeadline = Date.parse(deadline);

  if (!Number.isFinite(parsedDeadline)) {
    return false;
  }

  return Date.now() > parsedDeadline;
}

function findGame(gameId) {
  return currentGames.find((game) => game.id === gameId);
}

export function initializeGames(initialGames) {
  currentGames = cloneGames(initialGames);
}

export function getGames() {
  return cloneGames(currentGames);
}

export function createGame(input) {
  const title = normalizeText(input?.title);
  const description = normalizeText(input?.description);
  const entryLabel = normalizeText(input?.entryLabel) || 'Submission';
  const deadline = normalizeText(input?.deadline);
  const rewardPoints = normalizeRewardPoints(input?.rewardPoints);

  if (!title) {
    throw new Error('game title is required');
  }

  if (!description) {
    throw new Error('game description is required');
  }

  const game = {
    id: randomUUID(),
    title,
    description,
    entryLabel,
    deadline,
    rewardPoints,
    acceptingEntries: true,
    submissions: []
  };

  currentGames = [game, ...currentGames];
  return cloneGame(game);
}

export function setGameEntryStatus(gameId, acceptingEntries) {
  const game = findGame(gameId);

  if (!game) {
    throw new Error('Game not found');
  }

  game.acceptingEntries = Boolean(acceptingEntries);
  return cloneGame(game);
}

export function submitGameEntry({ gameId, teamId, teamName, college, entry }, awardPoints) {
  const game = findGame(gameId);

  if (!game) {
    throw new Error('Game not found');
  }

  if (!game.acceptingEntries || hasDeadlineExpired(game.deadline)) {
    throw new Error('Entries are closed for this game');
  }

  const normalizedEntry = normalizeText(entry);

  if (!normalizeText(teamId)) {
    throw new Error('teamId is required');
  }

  if (!normalizeText(teamName)) {
    throw new Error('team name is required');
  }

  if (!normalizedEntry) {
    throw new Error('entry is required');
  }

  if (game.submissions.some((submission) => submission.teamId === teamId)) {
    throw new Error('This team has already submitted for this game');
  }

  const submission = {
    id: randomUUID(),
    teamId,
    teamName,
    college: normalizeText(college),
    entry: normalizedEntry,
    createdAt: new Date().toISOString(),
    status: 'pending',
    awardedPoints: 0
  };

  game.submissions.unshift(submission);

  return {
    game: cloneGame(game),
    submission: cloneSubmission(submission)
  };
}

export function reviewGameSubmission({ gameId, submissionId, decision }, awardPoints) {
  const game = findGame(gameId);

  if (!game) {
    throw new Error('Game not found');
  }

  const submission = game.submissions.find((entry) => entry.id === submissionId);

  if (!submission) {
    throw new Error('Submission not found');
  }

  if (submission.status !== 'pending') {
    throw new Error('Submission already reviewed');
  }

  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error('decision must be approved or rejected');
  }

  submission.status = decision;
  submission.reviewedAt = new Date().toISOString();

  if (decision === 'approved') {
    const awardedPoints = game.rewardPoints;
    submission.awardedPoints = awardedPoints;

    if (typeof awardPoints === 'function' && awardedPoints > 0) {
      awardPoints(submission.teamId, awardedPoints);
    }
  }

  if (decision === 'rejected') {
    submission.awardedPoints = 0;
  }

  return {
    game: cloneGame(game),
    submission: cloneSubmission(submission)
  };
}
