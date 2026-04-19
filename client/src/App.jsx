import { useEffect, useMemo, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL ?? '';
const adminTokenStorageKey = 'ai-nexus-admin-token';

const formatCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

function fetchJson(path, options) {
  const requestHeaders = {
    'Content-Type': 'application/json',
    ...(options?.headers ?? {})
  };

  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: requestHeaders,
  }).then(async (response) => {
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Request failed';

      if (errorText) {
        try {
          const parsedError = JSON.parse(errorText);
          errorMessage = parsedError?.error || parsedError?.message || errorText;
        } catch {
          errorMessage = errorText;
        }
      }

      const requestError = new Error(errorMessage);
      requestError.status = response.status;
      throw requestError;
    }

    return response.json();
  });
}

function resolveGalleryImageUrl(imageUrl) {
  const normalized = String(imageUrl ?? '').trim();

  if (!normalized) {
    return normalized;
  }

  if (normalized.startsWith('/uploads/')) {
    return `/api${normalized}`;
  }

  return normalized;
}

function uploadPhoto(path, file, token) {
  const formData = new FormData();
  formData.append('photo', file);

  return fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  }).then(async (response) => {
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Upload failed');
    }

    return response.json();
  });
}

function buildInitials(name) {
  return String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function toMinutesFrom12Hour(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  const normalizedHour = period === 'AM'
    ? (hours === 12 ? 0 : hours)
    : (hours === 12 ? 12 : hours + 12);

  return (normalizedHour * 60) + minutes;
}

function parseEventDateLabel(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[-\s]+([A-Za-z]+)\s+(\d{4})$/);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const monthName = match[2].toLowerCase();
  const year = Number(match[3]);
  const monthIndexByName = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11
  };
  const monthIndex = monthIndexByName[monthName];

  if (!Number.isFinite(day) || !Number.isFinite(year) || monthIndex === undefined) {
    return null;
  }

  return new Date(year, monthIndex, day);
}

function sameCalendarDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function getScheduleDayIndex(timeLabel) {
  const dayMatch = String(timeLabel ?? '').match(/Day\s*(\d+)/i);

  if (!dayMatch) {
    return null;
  }

  const dayIndex = Number(dayMatch[1]);
  return Number.isFinite(dayIndex) ? dayIndex : null;
}

function resolveActiveScheduleDayIndex(now, eventDates, scheduleItems) {
  if (Array.isArray(eventDates) && eventDates.length > 0) {
    for (let index = 0; index < eventDates.length; index += 1) {
      const parsedDate = parseEventDateLabel(eventDates[index]);

      if (parsedDate && sameCalendarDate(now, parsedDate)) {
        return index + 1;
      }
    }

    // When event dates are provided, do not guess a day outside the event window.
    return null;
  }

  const dayIndexes = [...new Set(
    (scheduleItems ?? [])
      .map((item) => getScheduleDayIndex(item?.time))
      .filter((value) => Number.isFinite(value))
  )].sort((left, right) => left - right);

  return dayIndexes[0] ?? null;
}

function isScheduleItemActive(timeLabel, now, activeDayIndex) {
  if (!Number.isFinite(activeDayIndex)) {
    return false;
  }

  const dayIndex = getScheduleDayIndex(timeLabel);

  if (Number.isFinite(activeDayIndex) && Number.isFinite(dayIndex) && dayIndex !== activeDayIndex) {
    return false;
  }

  const matches = [...String(timeLabel ?? '').matchAll(/(\d{1,2}:\d{2}\s*[AP]M)/gi)];

  if (matches.length === 0) {
    return false;
  }

  const startMinute = toMinutesFrom12Hour(matches[0][1]);

  if (startMinute === null) {
    return false;
  }

  const hasOnwards = /onwards/i.test(String(timeLabel ?? ''));
  const fallbackEnd = hasOnwards ? (24 * 60) : Math.min(startMinute + 60, 24 * 60);
  const parsedEnd = matches[1] ? toMinutesFrom12Hour(matches[1][1]) : null;
  const endMinute = parsedEnd ?? fallbackEnd;
  const nowMinute = (now.getHours() * 60) + now.getMinutes();

  if (endMinute < startMinute) {
    return nowMinute >= startMinute || nowMinute < endMinute;
  }

  return nowMinute >= startMinute && nowMinute < endMinute;
}

function createAdminSnapshot(eventData, judges) {
  return {
    tracks: (eventData?.tracks ?? []).map((track) => ({ value: track })),
    contacts: (eventData?.contacts ?? []).map((contact) => ({
      name: contact.name,
      phone: contact.phone,
      label: contact.label
    })),
    photos: (eventData?.photos ?? []).map((photo) => ({
      imageUrl: photo.imageUrl,
      caption: photo.caption ?? ''
    })),
    judges: (judges ?? []).map((judge) => ({
      name: judge.name,
      companyName: judge.companyName ?? '',
      photoUrl: judge.photoUrl ?? ''
    }))
  };
}

function JudgeAvatar({ judge }) {
  const [hasImageError, setHasImageError] = useState(false);

  if (!judge.photoUrl || hasImageError) {
    return <div className="judge-avatar">{judge.initials || buildInitials(judge.name)}</div>;
  }

  return (
    <img
      className="judge-photo"
      src={judge.photoUrl}
      alt={`${judge.name} profile`}
      loading="lazy"
      onError={() => setHasImageError(true)}
    />
  );
}

function App() {
  const [eventData, setEventData] = useState(null);
  const [judges, setJudges] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [games, setGames] = useState([]);
  const [teams, setTeams] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [leaderboardQuery, setLeaderboardQuery] = useState('');
  const [scheduleQuery, setScheduleQuery] = useState('');
  const [adminData, setAdminData] = useState({ tracks: [], contacts: [], photos: [], judges: [] });
  const [adminAccessMessage, setAdminAccessMessage] = useState('');
  const [adminAccessError, setAdminAccessError] = useState('');
  const [adminSaveMessage, setAdminSaveMessage] = useState('');
  const [adminSaveError, setAdminSaveError] = useState('');
  const [photoUploadMessage, setPhotoUploadMessage] = useState('');
  const [photoUploadError, setPhotoUploadError] = useState('');
  const [photoUploadingIndex, setPhotoUploadingIndex] = useState(-1);
  const [gameMessage, setGameMessage] = useState('');
  const [gameError, setGameError] = useState('');
  const [gameAdminMessage, setGameAdminMessage] = useState('');
  const [gameAdminError, setGameAdminError] = useState('');
  const [gameSubmission, setGameSubmission] = useState({ gameId: '', teamId: '', entry: '' });
  const [gameDraft, setGameDraft] = useState({
    title: '',
    description: '',
    rewardPoints: '',
    deadline: '',
    entryLabel: 'Submission'
  });
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(adminTokenStorageKey) ?? '');
  const [adminUser, setAdminUser] = useState('');
  const [adminLogin, setAdminLogin] = useState({ username: '', password: '' });
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [photoFiles, setPhotoFiles] = useState({});
  const [judgePhotoFiles, setJudgePhotoFiles] = useState({});
  const [judgePhotoUploadMessage, setJudgePhotoUploadMessage] = useState('');
  const [judgePhotoUploadError, setJudgePhotoUploadError] = useState('');
  const [judgePhotoUploadingIndex, setJudgePhotoUploadingIndex] = useState(-1);

  function resetAdminSession() {
    setAdminToken('');
    setAdminUser('');
    localStorage.removeItem(adminTokenStorageKey);
  }

  function isUnauthorizedAdminError(error) {
    const message = String(error?.message ?? '');
    return error?.status === 401 || /unauthorized admin access/i.test(message);
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Promise.all([
      fetchJson('/api/event'),
      fetchJson('/api/judges'),
      fetchJson('/api/leaderboard'),
      fetchJson('/api/games'),
      fetchJson('/api/schedule')
    ])
      .then(([
        eventResponse,
        judgesResponse,
        leaderboardResponse,
        gamesResponse,
        scheduleResponse
      ]) => {
        setEventData(eventResponse);
        setJudges(judgesResponse.judges);
        setAdminData(createAdminSnapshot(eventResponse, judgesResponse.judges));
        setLeaderboard(leaderboardResponse.leaderboard);
        setTeams(leaderboardResponse.teams);
        setRounds(leaderboardResponse.rounds);
        setGames(gamesResponse.games ?? []);
        setSchedule(scheduleResponse.schedule);
        const firstTeamId = leaderboardResponse.teams[0]?.id ?? '';
        const firstGameId = gamesResponse.games?.[0]?.id ?? '';
        setGameSubmission((current) => ({
          gameId: firstGameId,
          teamId: firstTeamId,
          entry: current.entry
        }));
      })
      .catch((fetchError) => {
        setGameError(fetchError.message);
      });
  }, []);

  useEffect(() => {
    if (!gameSubmission.teamId && teams.length > 0) {
      setGameSubmission((current) => ({
        ...current,
        teamId: teams[0].id
      }));
    }
  }, [gameSubmission.teamId, teams]);

  useEffect(() => {
    if (!gameSubmission.gameId && games.length > 0) {
      setGameSubmission((current) => ({
        ...current,
        gameId: games[0].id
      }));
    }
  }, [gameSubmission.gameId, games]);

  useEffect(() => {
    if (!adminToken) {
      setAdminUser('');
      localStorage.removeItem(adminTokenStorageKey);
      return;
    }

    localStorage.setItem(adminTokenStorageKey, adminToken);

    fetchJson('/api/admin/session', {
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    })
      .then((response) => {
        setAdminUser(response.username);
      })
      .catch(() => {
        setAdminToken('');
        setAdminUser('');
        localStorage.removeItem(adminTokenStorageKey);
      });
  }, [adminToken]);

  useEffect(() => {
    const stream = new EventSource(`${apiBase}/api/stream`);

    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data);

      if (payload.leaderboard) {
        setLeaderboard(payload.leaderboard);
      }

      if (payload.teams) {
        setTeams(payload.teams);
      }

      if (payload.rounds) {
        setRounds(payload.rounds);
      }

      if (payload.games) {
        setGames(payload.games);
      }
    };

    stream.onerror = () => {
      stream.close();
    };

    return () => stream.close();
  }, []);

  const heroStats = useMemo(() => {
    if (!eventData) {
      return [];
    }

    return [
      { label: 'Prize Pool', value: formatCurrency.format(eventData.prizePool) },
      { label: 'Dates', value: eventData.dates.join(' to ') },
      { label: 'Venue', value: eventData.venue },
      { label: 'Tracks', value: eventData.tracks.length.toString() }
    ];
  }, [eventData]);

  const trackList = eventData?.tracks ?? [];
  const contactList = eventData?.contacts ?? [];
  const aiVisualHighlights = [
    {
      title: 'Neural Pulse Stage',
      tone: 'pulse'
    },
    {
      title: 'Vision Forge Grid',
      tone: 'forge'
    },
    {
      title: 'Prompt Reactor Core',
      tone: 'reactor'
    }
  ];

  const filteredLeaderboard = useMemo(() => {
    const query = leaderboardQuery.trim().toLowerCase();

    if (!query) {
      return leaderboard;
    }

    return leaderboard.filter((entry) => {
      return `${entry.teamName} ${entry.college}`.toLowerCase().includes(query);
    });
  }, [leaderboard, leaderboardQuery]);

  const filteredSchedule = useMemo(() => {
    const query = scheduleQuery.trim().toLowerCase();

    if (!query) {
      return schedule;
    }

    return schedule.filter((item) => {
      return `${item.time} ${item.title} ${item.description}`.toLowerCase().includes(query);
    });
  }, [schedule, scheduleQuery]);

  const activeScheduleDayIndex = useMemo(() => {
    return resolveActiveScheduleDayIndex(currentTime, eventData?.dates ?? [], filteredSchedule);
  }, [currentTime, eventData?.dates, filteredSchedule]);

  async function handleGameSubmission(event) {
    event.preventDefault();
    setGameMessage('');
    setGameError('');

    try {
      const response = await fetchJson(`/api/games/${gameSubmission.gameId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          teamId: gameSubmission.teamId,
          entry: gameSubmission.entry
        })
      });

      setLeaderboard(response.leaderboard);
      setTeams(response.teams);
      setRounds(response.rounds);
      setGames(response.games);
      setGameMessage('Entry submitted for admin review. Points will be added after approval.');
      setGameSubmission((current) => ({ ...current, entry: '' }));
    } catch (submitError) {
      setGameError(submitError.message);
    }
  }

  async function handleSubmissionReview(gameId, submissionId, decision) {
    setGameAdminMessage('');
    setGameAdminError('');

    try {
      const response = await fetchJson(`/api/admin/games/${gameId}/submissions/${submissionId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ decision })
      });

      setGames(response.games);
      setLeaderboard(response.leaderboard);
      setTeams(response.teams);
      setRounds(response.rounds);
      setGameAdminMessage(
        decision === 'approved'
          ? 'Submission approved and points awarded.'
          : 'Submission rejected. No points were awarded.'
      );
    } catch (reviewError) {
      if (isUnauthorizedAdminError(reviewError)) {
        resetAdminSession();
        setGameAdminError('Admin session expired. Please login again and retry.');
        return;
      }

      setGameAdminError(reviewError.message);
    }
  }

  function updateGameDraft(field, value) {
    setGameDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleGameCreate(event) {
    event.preventDefault();
    setGameAdminMessage('');
    setGameAdminError('');

    if (!adminToken) {
      setGameAdminError('Please login as admin first.');
      return;
    }

    try {
      const response = await fetchJson('/api/admin/games', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          title: gameDraft.title,
          description: gameDraft.description,
          rewardPoints: Number(gameDraft.rewardPoints),
          deadline: gameDraft.deadline,
          entryLabel: gameDraft.entryLabel
        })
      });

      setGames(response.games);
      setLeaderboard(response.leaderboard);
      setTeams(response.teams);
      setRounds(response.rounds);
      setGameDraft({
        title: '',
        description: '',
        rewardPoints: '',
        deadline: '',
        entryLabel: 'Submission'
      });
      setGameAdminMessage('Game posted successfully.');
    } catch (createError) {
      if (isUnauthorizedAdminError(createError)) {
        resetAdminSession();
        setGameAdminError('Admin session expired. Please login again and retry.');
        return;
      }

      setGameAdminError(createError.message);
    }
  }

  async function handleGameEntryToggle(gameId, acceptingEntries) {
    setGameAdminMessage('');
    setGameAdminError('');

    try {
      const response = await fetchJson(`/api/admin/games/${gameId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ acceptingEntries })
      });

      setGames(response.games);
      setLeaderboard(response.leaderboard);
      setTeams(response.teams);
      setRounds(response.rounds);
      setGameAdminMessage(acceptingEntries ? 'Game entry window reopened.' : 'Game entry window closed.');
    } catch (toggleError) {
      if (isUnauthorizedAdminError(toggleError)) {
        resetAdminSession();
        setGameAdminError('Admin session expired. Please login again and retry.');
        return;
      }

      setGameAdminError(toggleError.message);
    }
  }

  function addTrack() {
    setAdminData((current) => ({
      ...current,
      tracks: [...current.tracks, { value: '' }]
    }));
  }

  function removeTrack(index) {
    setAdminData((current) => ({
      ...current,
      tracks: current.tracks.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function updateTrack(index, value) {
    setAdminData((current) => ({
      ...current,
      tracks: current.tracks.map((track, itemIndex) =>
        itemIndex === index ? { ...track, value } : track
      )
    }));
  }

  function addContact() {
    setAdminData((current) => ({
      ...current,
      contacts: [...current.contacts, { name: '', phone: '', label: '' }]
    }));
  }

  function removeContact(index) {
    setAdminData((current) => ({
      ...current,
      contacts: current.contacts.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function updateContact(index, field, value) {
    setAdminData((current) => ({
      ...current,
      contacts: current.contacts.map((contact, itemIndex) =>
        itemIndex === index ? { ...contact, [field]: value } : contact
      )
    }));
  }

  function addJudge() {
    setAdminData((current) => ({
      ...current,
      judges: [...current.judges, { name: '', companyName: '', photoUrl: '' }]
    }));
  }

  function addPhoto() {
    setAdminData((current) => ({
      ...current,
      photos: [...current.photos, { imageUrl: '', caption: '' }]
    }));
  }

  function removePhoto(index) {
    setAdminData((current) => ({
      ...current,
      photos: current.photos.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function updatePhoto(index, field, value) {
    setAdminData((current) => ({
      ...current,
      photos: current.photos.map((photo, itemIndex) =>
        itemIndex === index ? { ...photo, [field]: value } : photo
      )
    }));
  }

  function selectPhotoFile(index, file) {
    setPhotoFiles((current) => ({
      ...current,
      [index]: file || null
    }));
  }

  async function handlePhotoUpload(index) {
    setPhotoUploadMessage('');
    setPhotoUploadError('');

    if (!adminToken) {
      setPhotoUploadError('Please login as admin first.');
      return;
    }

    const selectedFile = photoFiles[index];

    if (!selectedFile) {
      setPhotoUploadError('Please choose an image file first.');
      return;
    }

    try {
      setPhotoUploadingIndex(index);
      const uploadResponse = await uploadPhoto('/api/admin/photos/upload', selectedFile, adminToken);
      updatePhoto(index, 'imageUrl', uploadResponse.imageUrl);
      setPhotoFiles((current) => ({
        ...current,
        [index]: null
      }));
      setPhotoUploadMessage('Photo uploaded. Click Save admin changes to publish it.');
    } catch (uploadError) {
      setPhotoUploadError(uploadError.message);
    } finally {
      setPhotoUploadingIndex(-1);
    }
  }

  function removeJudge(index) {
    setAdminData((current) => ({
      ...current,
      judges: current.judges.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function updateJudge(index, field, value) {
    setAdminData((current) => ({
      ...current,
      judges: current.judges.map((judge, itemIndex) =>
        itemIndex === index ? { ...judge, [field]: value } : judge
      )
    }));
  }

  function selectJudgePhotoFile(index, file) {
    setJudgePhotoFiles((current) => ({
      ...current,
      [index]: file || null
    }));
  }

  async function handleJudgePhotoUpload(index) {
    setJudgePhotoUploadMessage('');
    setJudgePhotoUploadError('');

    if (!adminToken) {
      setJudgePhotoUploadError('Please login as admin first.');
      return;
    }

    const selectedFile = judgePhotoFiles[index];

    if (!selectedFile) {
      setJudgePhotoUploadError('Please choose an image file first.');
      return;
    }

    try {
      setJudgePhotoUploadingIndex(index);
      const uploadResponse = await uploadPhoto('/api/admin/judges/upload', selectedFile, adminToken);
      updateJudge(index, 'photoUrl', uploadResponse.photoUrl);
      setJudgePhotoFiles((current) => ({
        ...current,
        [index]: null
      }));
      setJudgePhotoUploadMessage('Judge photo uploaded. Click Save admin changes to publish it.');
    } catch (uploadError) {
      setJudgePhotoUploadError(uploadError.message);
    } finally {
      setJudgePhotoUploadingIndex(-1);
    }
  }

  async function handleAdminSave(event) {
    event.preventDefault();
    setAdminSaveMessage('');
    setAdminSaveError('');

    if (!adminToken) {
      setAdminSaveError('Please login as admin first.');
      return;
    }

    const payload = {
      tracks: adminData.tracks.map((track) => track.value.trim()).filter(Boolean),
      contacts: adminData.contacts
        .map((contact) => ({
          name: contact.name.trim(),
          phone: contact.phone.trim(),
          label: contact.label.trim()
        }))
        .filter((contact) => contact.name && contact.phone && contact.label),
      photos: adminData.photos
        .map((photo) => ({
          imageUrl: photo.imageUrl.trim(),
          caption: photo.caption.trim()
        }))
        .filter((photo) => photo.imageUrl),
      judges: adminData.judges
        .map((judge) => ({
          name: judge.name.trim(),
          companyName: judge.companyName.trim(),
          photoUrl: judge.photoUrl.trim()
        }))
        .filter((judge) => judge.name)
    };

    try {
      const response = await fetchJson('/api/admin/content', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify(payload)
      });

      setEventData(response.event);
      setJudges(response.judges);
      setAdminData(createAdminSnapshot(response.event, response.judges));
      setAdminSaveMessage('Site content updated successfully.');
    } catch (submitError) {
      setAdminSaveError(submitError.message);
    }
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    setAdminAccessError('');
    setAdminAccessMessage('');

    try {
      const response = await fetchJson('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          username: adminLogin.username,
          password: adminLogin.password
        })
      });

      setAdminToken(response.token);
      setAdminUser(response.username);
      setAdminLogin({ username: '', password: '' });
      setAdminAccessMessage('Admin access granted.');
    } catch (loginError) {
      setAdminAccessError(loginError.message || 'Admin login failed');
    }
  }

  async function handleAdminLogout() {
    setAdminAccessError('');

    if (adminToken) {
      try {
        await fetchJson('/api/admin/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`
          }
        });
      } catch {
        // Ignore logout failures and clear local auth state regardless.
      }
    }

    setAdminToken('');
    setAdminUser('');
    setAdminLogin({ username: '', password: '' });
    setAdminSaveMessage('');
    setAdminSaveError('');
    setAdminAccessMessage('Logged out from admin panel.');
  }

  const isAdminRoute = window.location.pathname.toLowerCase().startsWith('/admin');

  if (isAdminRoute) {
    return (
      <div className="page-shell admin-page-shell">
        <header className="hero admin-hero">
          <div className="hero-copy">
            <p className="eyebrow">Admin portal</p>
            <h1>AI NEXUS</h1>
            <div className="hero-actions">
              <a className="secondary-button" href="/">
                Go to participant page
              </a>
            </div>
          </div>
        </header>

        <main className="content-grid">
          <section className="panel" aria-labelledby="admin-heading" id="admin-editor">
            <div className="section-heading">
              <p className="eyebrow">Admin controls</p>
              <h2 id="admin-heading">Edit tracks, contacts, and judge profiles</h2>
            </div>

            {!adminToken ? (
              <form className="admin-login-form" onSubmit={handleAdminLogin}>
                <p className="admin-login-copy">
                  This page is restricted.Contact Admin for any issue.
                </p>
                <div className="admin-login-grid">
                  <label>
                    Username
                    <input
                      type="text"
                      autoComplete="username"
                      value={adminLogin.username}
                      onChange={(event) =>
                        setAdminLogin((current) => ({ ...current, username: event.target.value }))
                      }
                      placeholder="Admin username"
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={adminLogin.password}
                      onChange={(event) =>
                        setAdminLogin((current) => ({ ...current, password: event.target.value }))
                      }
                      placeholder="Admin password"
                      required
                    />
                  </label>
                </div>
                <button className="primary-button" type="submit">
                  Login as admin
                </button>
                {adminAccessError ? <p className="error-text">{adminAccessError}</p> : null}
                {adminAccessMessage ? <p className="success-text">{adminAccessMessage}</p> : null}
              </form>
            ) : (
              <form className="admin-form" onSubmit={handleAdminSave}>
                <div className="admin-auth-bar">
                  <p>Signed in as {adminUser || 'admin'}</p>
                  <button type="button" className="secondary-button" onClick={handleAdminLogout}>
                    Logout
                  </button>
                </div>

                <div className="admin-block">
                  <div className="admin-block-head">
                    <h3>Tracks</h3>
                    <button type="button" className="secondary-button" onClick={addTrack}>
                      Add track
                    </button>
                  </div>
                  {adminData.tracks.map((track, index) => (
                    <div key={`track-${index}`} className="admin-row inline">
                      <input
                        type="text"
                        value={track.value}
                        onChange={(event) => updateTrack(index, event.target.value)}
                        placeholder="Track name"
                      />
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => removeTrack(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="admin-block">
                  <div className="admin-block-head">
                    <h3>Contacts</h3>
                    <button type="button" className="secondary-button" onClick={addContact}>
                      Add contact
                    </button>
                  </div>
                  {adminData.contacts.map((contact, index) => (
                    <div key={`contact-${index}`} className="admin-row">
                      <input
                        type="text"
                        value={contact.name}
                        onChange={(event) => updateContact(index, 'name', event.target.value)}
                        placeholder="Name"
                      />
                      <input
                        type="text"
                        value={contact.phone}
                        onChange={(event) => updateContact(index, 'phone', event.target.value)}
                        placeholder="Phone"
                      />
                      <input
                        type="text"
                        value={contact.label}
                        onChange={(event) => updateContact(index, 'label', event.target.value)}
                        placeholder="Label"
                      />
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => removeContact(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="admin-block">
                  <div className="admin-block-head">
                    <h3>Event photographs</h3>
                    <button type="button" className="secondary-button" onClick={addPhoto}>
                      Add photo
                    </button>
                  </div>
                  {adminData.photos.map((photo, index) => (
                    <div key={`photo-${index}`} className="admin-row">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => selectPhotoFile(index, event.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handlePhotoUpload(index)}
                        disabled={photoUploadingIndex === index}
                      >
                        {photoUploadingIndex === index ? 'Uploading...' : 'Upload'}
                      </button>
                      <input
                        type="text"
                        value={photo.caption}
                        onChange={(event) => updatePhoto(index, 'caption', event.target.value)}
                        placeholder="Caption"
                      />
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => removePhoto(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {photoUploadMessage ? <p className="success-text">{photoUploadMessage}</p> : null}
                  {photoUploadError ? <p className="error-text">{photoUploadError}</p> : null}
                </div>

                <div className="admin-block">
                  <div className="admin-block-head">
                    <h3>Judges</h3>
                    <button type="button" className="secondary-button" onClick={addJudge}>
                      Add judge
                    </button>
                  </div>
                  {adminData.judges.map((judge, index) => (
                    <div key={`judge-${index}`} className="admin-row">
                      <input
                        type="text"
                        value={judge.name}
                        onChange={(event) => updateJudge(index, 'name', event.target.value)}
                        placeholder="Judge name"
                      />
                      <input
                        type="text"
                        value={judge.companyName}
                        onChange={(event) => updateJudge(index, 'companyName', event.target.value)}
                        placeholder="Company name"
                      />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => selectJudgePhotoFile(index, event.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleJudgePhotoUpload(index)}
                        disabled={judgePhotoUploadingIndex === index}
                      >
                        {judgePhotoUploadingIndex === index ? 'Uploading...' : 'Upload Photo'}
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => removeJudge(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {judgePhotoUploadMessage ? <p className="success-text">{judgePhotoUploadMessage}</p> : null}
                  {judgePhotoUploadError ? <p className="error-text">{judgePhotoUploadError}</p> : null}
                </div>

                <button className="primary-button" type="submit">
                  Save admin changes
                </button>
                {adminSaveMessage ? <p className="success-text">{adminSaveMessage}</p> : null}
                {adminSaveError ? <p className="error-text">{adminSaveError}</p> : null}
              </form>
            )}
          </section>

            {adminToken ? (
              <section className="panel" aria-labelledby="game-admin-heading" id="game-admin">
                <div className="section-heading">
                  <p className="eyebrow">Game arena admin</p>
                  <h2 id="game-admin-heading">Post tasks, close entry windows, and review submissions</h2>
                </div>

                <form className="admin-form" onSubmit={handleGameCreate}>
                  <div className="admin-block">
                    <div className="admin-block-head">
                      <h3>Create a game</h3>
                    </div>
                    <div className="admin-row">
                      <input
                        type="text"
                        value={gameDraft.title}
                        onChange={(event) => updateGameDraft('title', event.target.value)}
                        placeholder="Game title"
                        required
                      />
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={gameDraft.rewardPoints}
                        onChange={(event) => updateGameDraft('rewardPoints', event.target.value)}
                        placeholder="Points"
                        required
                      />
                      <input
                        type="datetime-local"
                        value={gameDraft.deadline}
                        onChange={(event) => updateGameDraft('deadline', event.target.value)}
                        required
                      />
                    </div>
                    <textarea
                      rows={4}
                      value={gameDraft.description}
                      onChange={(event) => updateGameDraft('description', event.target.value)}
                      placeholder="Game description"
                      required
                    />
                    <input
                      type="text"
                      value={gameDraft.entryLabel}
                      onChange={(event) => updateGameDraft('entryLabel', event.target.value)}
                      placeholder="Entry label"
                    />
                    <button className="primary-button" type="submit">
                      Post game
                    </button>
                  </div>
                </form>

                <div className="admin-block">
                  <div className="admin-block-head">
                    <h3>Posted games</h3>
                  </div>
                  <div className="game-admin-list">
                    {games.map((game) => (
                      <article key={game.id} className="game-admin-card">
                        <div className="game-card-head">
                          <div>
                            <h3>{game.title}</h3>
                            <p>{game.description}</p>
                          </div>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleGameEntryToggle(game.id, !game.acceptingEntries)}
                          >
                            {game.acceptingEntries ? 'Close entries' : 'Open entries'}
                          </button>
                        </div>
                        <div className="game-meta">
                          <span>{game.entryLabel || 'Submission'}</span>
                          <span>{game.rewardPoints} points</span>
                          <span>
                            Deadline:{' '}
                            {game.deadline
                              ? new Date(game.deadline).toLocaleString([], {
                                  dateStyle: 'medium',
                                  timeStyle: 'short'
                                })
                              : 'No deadline set'}
                          </span>
                          <span>{game.submissions?.length ?? 0} submissions</span>
                        </div>
                        <div className="submission-list">
                          {(game.submissions ?? []).length === 0 ? (
                            <p className="empty-state">No entries yet for this game.</p>
                          ) : (
                            game.submissions.map((submission) => (
                              <article key={submission.id} className="submission-card">
                                <div>
                                  <h4>{submission.teamName}</h4>
                                  <p>{submission.college}</p>
                                </div>
                                <div>
                                  <strong>{submission.awardedPoints || 0} points</strong>
                                  <p>Status: {submission.status}</p>
                                  <p>{new Date(submission.createdAt).toLocaleString()}</p>
                                </div>
                                <p>{submission.entry}</p>
                                {submission.status === 'pending' ? (
                                  <div className="submission-actions">
                                    <button
                                      type="button"
                                      className="primary-button"
                                      onClick={() => handleSubmissionReview(game.id, submission.id, 'approved')}
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      className="danger-button"
                                      onClick={() => handleSubmissionReview(game.id, submission.id, 'rejected')}
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : null}
                              </article>
                            ))
                          )}
                        </div>
                      </article>
                    ))}
                    {games.length === 0 ? (
                      <p className="empty-state">No games posted yet. Use the form above to start the arena.</p>
                    ) : null}
                  </div>
                  {gameAdminMessage ? <p className="success-text">{gameAdminMessage}</p> : null}
                  {gameAdminError ? <p className="error-text">{gameAdminError}</p> : null}
                </div>
              </section>
            ) : null}
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <a className="admin-login-corner" href="/admin">
        Admin login
      </a>

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">AI NEXUS 2026</p>
          <h1>{eventData?.subtitle ?? 'Build the future with AI.'}</h1>
          <p className="hero-text">
            {eventData?.summary ??
              'A fast-paced hackathon with live scoring, AI challenges, and creator energy.'}
          </p>
          <div className="hero-tags" aria-label="Event vibe tags">
            <span>Future mode</span>
            <span>Live scoring</span>
            <span>AI first</span>
          </div>
          <div className="hero-actions">
            <a className="primary-button" href="#leaderboard">
              View leaderboard
            </a>
            <a className="secondary-button" href="#judges">
              Meet the judges
            </a>
          </div>
        </div>

        <div className="hero-card">
          <p className="hero-card-title">Event snapshot</p>
          <h2>{eventData?.title ?? 'AI NEXUS 2026'}</h2>
          <div className="stat-grid">
            {heroStats.map((stat) => (
              <article key={stat.label} className="stat-card">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </article>
            ))}
          </div>
        </div>
      </header>

      <main className="content-grid">

        {/* <section className="panel spotlight vibe-panel" aria-labelledby="visuals-heading">
          <div className="section-heading">
            <p className="eyebrow">Nexus visuals</p>
            <h2 id="visuals-heading">Future AI environment</h2>
          </div>
          <div className="vibe-grid">
            {aiVisualHighlights.map((visual) => (
              <article key={visual.title} className={`vibe-card vibe-${visual.tone}`}>
                <div className="vibe-glow" aria-hidden="true" />
                <h3>{visual.title}</h3>
              </article>
            ))}
          </div>
        </section> */}

        <section className="panel" aria-labelledby="leaderboard-heading" id="leaderboard">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Live leaderboard</p>
              <h2 id="leaderboard-heading">Real-time rankings</h2>
            </div>
            <span className="live-pill">Live</span>
          </div>
          <label className="search-field" htmlFor="leaderboard-search">
            Search your team
            <input
              id="leaderboard-search"
              type="search"
              value={leaderboardQuery}
              onChange={(event) => setLeaderboardQuery(event.target.value)}
              placeholder="Type a team name or college"
            />
          </label>
          <div className="leaderboard-list">
            {filteredLeaderboard.map((entry, index) => (
              <article key={entry.teamId} className="leaderboard-row">
                <div>
                  <span className="rank">#{index + 1}</span>
                  <h3>{entry.teamName}</h3>
                  <p>{entry.college}</p>
                </div>
                <div className="score-block">
                  <strong>{entry.total}</strong>
                  <span>points</span>
                </div>
              </article>
            ))}
            {filteredLeaderboard.length === 0 ? (
              <p className="empty-state">No teams match this search yet.</p>
            ) : null}
          </div>
        </section>

        <section className="panel" aria-labelledby="judges-heading" id="judges">
          <div className="section-heading">
            <p className="eyebrow">Judges</p>
            <h2 id="judges-heading">Review panel</h2>
          </div>
          <div className="judge-grid">
            {judges.map((judge) => (
              <article key={judge.name} className="judge-card">
                <JudgeAvatar judge={judge} />
                <div>
                  <h3>{judge.name}</h3>
                  <p className="judge-role">{judge.companyName}</p>
                </div>
              </article>
            ))}
            {judges.length === 0 ? (
              <p className="empty-state">Judge details will be added by the admin.</p>
            ) : null}
          </div>
        </section>

        <section className="panel" aria-labelledby="gallery-heading" id="gallery">
          <div className="section-heading">
            <p className="eyebrow">Event gallery</p>
            <h2 id="gallery-heading">Visual feed</h2>
          </div>
          <div className="gallery-grid">
            {(eventData?.photos ?? []).map((photo, index) => (
              <article key={`${photo.imageUrl}-${index}`} className="gallery-card">
                <img
                  src={resolveGalleryImageUrl(photo.imageUrl)}
                  alt={photo.caption || 'Event photograph'}
                  loading="lazy"
                />
                {photo.caption ? <p>{photo.caption}</p> : null}
              </article>
            ))}
            {(eventData?.photos ?? []).length === 0 ? (
              <>
                <article className="gallery-card ai-placeholder-card ai-placeholder-1">
                  <div className="ai-placeholder-image" role="img" aria-label="Abstract AI themed visual" />
                  <p>AI concept frame</p>
                </article>
                <article className="gallery-card ai-placeholder-card ai-placeholder-2">
                  <div className="ai-placeholder-image" role="img" aria-label="Creative futuristic event visual" />
                  <p>Future scene</p>
                </article>
                <article className="gallery-card ai-placeholder-card ai-placeholder-3">
                  <div className="ai-placeholder-image" role="img" aria-label="Vibrant digital art style visual" />
                  <p>Nexus pulse</p>
                </article>
              </>
            ) : null}
          </div>
        </section>

        <section className="panel" aria-labelledby="game-arena-heading" id="game-arena">
          <div className="section-heading">
            <p className="eyebrow">Game Arena</p>
            <h2 id="game-arena-heading">Tasks and submissions</h2>
          </div>
          <div className="game-grid">
            {games.map((game) => {
              const isClosed = !game.acceptingEntries;
              const deadlineText = game.deadline
                ? new Date(game.deadline).toLocaleString([], {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  })
                : 'No deadline set';

              return (
                <article key={game.id} className="game-card">
                  <div className="game-card-head">
                    <div>
                      <h3>{game.title}</h3>
                      <p>{game.description}</p>
                    </div>
                    <span className={isClosed ? 'closed-pill' : 'live-pill'}>
                      {isClosed ? 'Closed' : 'Open'}
                    </span>
                  </div>
                  <div className="game-meta">
                    <span>{game.entryLabel || 'Submission'}</span>
                    <span>{game.rewardPoints} points</span>
                    <span>Deadline: {deadlineText}</span>
                    <span>{game.submissions?.length ?? 0} submissions</span>
                  </div>
                </article>
              );
            })}
            {games.length === 0 ? (
              <p className="empty-state">No games have been posted yet. Check back soon.</p>
            ) : null}
          </div>
          <form className="score-form" onSubmit={handleGameSubmission}>
            <label>
              Team
              <select
                value={gameSubmission.teamId}
                onChange={(event) => setGameSubmission({ ...gameSubmission, teamId: event.target.value })}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Game
              <select
                value={gameSubmission.gameId}
                onChange={(event) => setGameSubmission({ ...gameSubmission, gameId: event.target.value })}
              >
                {games.map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.title}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Entry
              <textarea
                rows={4}
                value={gameSubmission.entry}
                onChange={(event) => setGameSubmission({ ...gameSubmission, entry: event.target.value })}
                placeholder="Describe the solution, answer, or completed task"
              />
            </label>

            <button className="primary-button" type="submit" disabled={!games.length}>
              Submit entry
            </button>
          </form>
          {gameMessage ? <p className="success-text">{gameMessage}</p> : null}
          {gameError ? <p className="error-text">{gameError}</p> : null}
        </section>

        <section className="panel" aria-labelledby="schedule-heading">
          <div className="section-heading">
            <p className="eyebrow">Schedule</p>
            <h2 id="schedule-heading">Event timeline</h2>
          </div>
          <label className="search-field" htmlFor="schedule-search">
            Filter agenda items
            <input
              id="schedule-search"
              type="search"
              value={scheduleQuery}
              onChange={(event) => setScheduleQuery(event.target.value)}
              placeholder="Search by time, title, or description"
            />
          </label>
          <div className="timeline schedule-timeline">
            {filteredSchedule.map((item) => {
              const isActive = isScheduleItemActive(item.time, currentTime, activeScheduleDayIndex);

              return (
                <article
                  key={item.time}
                  className={`timeline-item${isActive ? ' timeline-item-active' : ''}`}
                >
                  <span>{item.time}</span>
                  <div>
                    <h3>{item.title}</h3>
                    {isActive ? <span className="timeline-live-now">Live now</span> : null}
                    <p>{item.description}</p>
                  </div>
                </article>
              );
            })}
            {filteredSchedule.length === 0 ? (
              <p className="empty-state">No schedule entries match this filter.</p>
            ) : null}
          </div>
        </section>

        <section className="panel" aria-labelledby="tracks-heading" id="tracks">
          <div className="section-heading">
            <p className="eyebrow">Tracks and themes</p>
            <h2 id="tracks-heading">Build tracks</h2>
          </div>
          <div className="track-grid">
            {trackList.map((track) => (
              <article key={track} className="track-card">
                <h3>{track}</h3>
              </article>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="support-heading" id="support">
          <div className="section-heading">
            <p className="eyebrow">Contact and support</p>
            <h2 id="support-heading">Help desk</h2>
          </div>
          <div className="support-grid">
            {contactList.map((contact) => (
              <article key={contact.name} className="support-card">
                <h3>{contact.name}</h3>
                <p>{contact.label}</p>
                <a href={`tel:${contact.phone.replace(/\s+/g, '')}`}>{contact.phone}</a>
              </article>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}

export default App;