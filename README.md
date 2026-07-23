# Codec Ludo 🎲

A private, invite-only, real-time multiplayer Ludo web app. Built for playing classic
strict-rules Ludo live with the people you know — no ads, no strangers, no public signup.

## Features

- **Live multiplayer board** — dice rolls and token moves appear instantly on every
  player's screen (Socket.io), with a 3D dice cube and path-following token animation
- **Server-authoritative rules** — the server rolls every die and validates every move,
  so nobody can cheat from their browser
- **Classic strict Ludo** — 6 to leave the yard, safe squares, captures, exact-count
  finish, extra turn on a 6, forfeit on three consecutive sixes
- **Invite flow** — create a room, invite 2–4 registered players, start when enough accept
- **Admin-confirmed results** — finished games only count after the admin confirms them;
  confirmed games feed career stats and an all-time sortable leaderboard
- **Invite-only accounts** — the admin creates every account; single active session per
  user, JWT in httpOnly cookies

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Tailwind CSS (Vite) |
| Backend | Python + FastAPI |
| Realtime | python-socketio over ASGI |
| Database | Postgres (SQLite for local dev), via SQLModel |
| Auth | JWT in httpOnly cookies + bcrypt |

## Running locally

```bash
# Backend (http://127.0.0.1:8000, interactive API docs at /docs)
cd backend
python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/uvicorn app.main:app --reload

# Frontend (http://localhost:5173, proxies API calls to the backend)
cd frontend
npm install
npm run dev
```

Configuration lives in environment variables (see `backend/app/config.py`); local dev
falls back to a SQLite file and dev defaults with zero setup.

## Credits

Architecture and design by **Sunny Kumar** ([bunnycodec.com](https://bunnycodec.com)).
[Claude Code](https://claude.com/claude-code) was actively used during coding.
