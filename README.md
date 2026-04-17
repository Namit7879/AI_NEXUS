# AI NEXUS 2026

Full-stack event website for AI NEXUS 2026 built with React on the frontend and Express.js on the backend.

## What it includes

- Event hero section built from the poster details
- Suggested website features section
- Judge profiles section
- Live leaderboard that updates through server-sent events
- Round score submission form for instant leaderboard changes
- Schedule, tracks, prize pool, and contact details

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Live updates: Server-sent events

## Run Locally

1. Install dependencies at the repo root:

```bash
npm install
```

2. Start both apps:

```bash
npm run dev
```

3. Open the frontend in the browser:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000`

## Admin Access (Separate Login)

The admin editor is now protected by a separate login. Non-admin users can see only the login form and cannot submit content updates.

Configure credentials with environment variables before starting the server:

```bash
ADMIN_USERNAME=your_admin_user
ADMIN_PASSWORD=your_strong_password
```

If these are not set, development defaults are used:

- Username: `admin`
- Password: `admin123`

Set custom credentials in production.

## Production Build

```bash
npm run build
npm run start
```

The Express server serves the built React app from `client/dist` when it exists.

## Customize the Content

- Replace the placeholder judge names, bios, and avatars in `server/src/data.js`
- Update the team list and scoring rounds in the same file
- Replace any placeholder registration or social links with your official URLs

## Game Arena

- Admins can post timed games from the admin page
- Teams submit entries from the participant page before the deadline or until entries are closed
- Each valid entry awards points immediately and updates the leaderboard live
- Admins can close or reopen a game entry window and review submissions by team name

## Runtime Persistence

- Admin content edits and leaderboard score updates are saved to `server/data/runtime-data.json`
- The server falls back to the defaults in `server/src/data.js` only if that runtime file is missing or invalid
- To reset the site data, delete `server/data/runtime-data.json` and restart the server

## Recommended Website Features

- Registration and ticketing section
- Countdown timer to the event
- Judges and mentors showcase
- Live leaderboard with round-by-round updates
- Schedule and agenda timeline
- Sponsor wall and partner highlights
- FAQ section for participants
- Contact and support panel