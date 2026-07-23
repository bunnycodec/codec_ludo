# Codec Ludo — Build Specification

> Written under the project's original working name "Family Ludo" — the official name is now **Codec Ludo**, and it's invite-only for anyone the admin adds, not only family.

This document is the complete, agreed specification for a private, account-based, real-time Ludo web app built for a family spread across different cities. Follow the **Development Process Rules (Section 13)** strictly — this is not a build-in-one-go project.

---

## 1. Project Overview

- Private multiplayer Ludo, 2–4 players per game
- Family members log in from different cities and play together in real time
- No public access — invite-only accounts, admin-controlled

---

## 2. Tech Stack

- **Frontend:** React + Tailwind CSS
- **Realtime:** python-socketio (Socket.io protocol, mounted into the FastAPI app via ASGI — same JS Socket.io client on the frontend, no protocol change)
- **Backend:** Python + FastAPI — chosen over Node/Express so the user (an experienced Python developer) can directly read every backend file, and for FastAPI's auto-generated interactive API docs (Swagger UI)
- **Database:** Postgres, free managed tier (Neon or Supabase) — chosen over SQLite so game/leaderboard data survives redeploys and server restarts without needing a paid persistent disk. Accessed via SQLModel (SQLAlchemy + Pydantic combined)
- **Auth:** JWT in httpOnly cookies, bcrypt password hashing, **one active session per account** (a new login invalidates the previous session/device)
- **Hosting:** Single Node service serving the built React app + API + Socket.io from one origin (avoids CORS complexity). Deploy to Render's **free** web service tier — accepts cold starts (~30-50s wake after ~15 min idle) in exchange for $0/month cost. A custom domain the user already owns will be pointed at the deployment via CNAME once first deployed.
- **Design:** Mobile-first responsive (family primarily on phones)

---

## 3. Roles & Accounts

- Two roles: `admin` and `player`
- **No public registration.** Login page only.
- Admin creates every account manually via a "Manage Family" section in their Dashboard (add username + temp password)
- New accounts are forced to change their password on first login
- Players can change their own password anytime from their Dashboard
- Admin can reset any player's password

---

## 4. Pages

1. **Login** — no registration link, admin-provisioned accounts only
2. **Player Dashboard** — personal stats snapshot, pending invites, "Create Game" button
   - Admin additionally sees: "Manage Family" (add/reset accounts), "Pending Confirmations" queue/badge
3. **Build the Game** — creator selects 2–4 registered players and sends invites
4. **Main Game Page** — live Ludo board
5. **Leaderboard** — global stats table

---

## 5. Game Creation & Invite Flow

- Creator selects **2 to 4** registered players (may include themselves) and sends invites
- Invited players see the pending invite in-app on their Dashboard when it's open (no push or email notifications — family coordinates timing via WhatsApp beforehand, by design)
- **Start Game** button is disabled until **at least 2** invitees have accepted; once 2+ have accepted, it becomes enabled and the creator may start immediately or keep waiting for the rest
- The moment the creator hits Start, any invites still pending are **cancelled**
- If an invite is declined, the creator can pick a replacement player and resend

---

## 6. Game Rules — Classic Strict Ludo

- Standard 4-color board (Red/Green/Yellow/Blue). With fewer than 4 players, unused colors' home yards simply stay empty.
- Colors are **randomly assigned** to participants at the start of every game — not tied to a player profile or preference.
- A 6 is required to move a token out of its home yard.
- Exact roll count is required to enter the home column and finish.
- Landing on an opponent's token sends it back to their home yard, **except** on the 8 safe squares (each color's starting square + 4 star squares).
- **No blockades** — tokens never block or stack-block each other, regardless of how many share a square.
- Rolling a 6 grants an extra turn; three consecutive 6s forfeits the turn.
- **No turn timer** — the game waits indefinitely for the active player.
- **Win condition:** play continues until every participating player has finished and is ranked (1st through last) — the game does not end when the first player finishes.
- **Server-authoritative:** dice rolls and move legality are decided by the server, never the client. The browser only renders what the server reports happened.

---

## 7. Mid-Game Cancellation

- Only the game's **creator** or an **admin** can cancel an in-progress game
- Cancelled games are stored for audit visibility but are **fully excluded** from all leaderboard stats
- There is no separate "leave game" feature for regular players. If a participant needs to exit mid-game, they coordinate with the creator/admin outside the app (WhatsApp), who then formally cancels it. Do not build an in-app leave/forfeit feature.

---

## 8. Reconnection

- Players are identified by account, not browser session
- If a player's connection drops mid-game, reopening the app should automatically rejoin them to their active game
- Since there is no turn timer, the game simply waits for them to reconnect and take their turn — no auto-skip, no bot takeover
- **One active session per account** (see Section 2): logging in on a new device ends the previous session there, so reconnection always means "come back on the same device/session," not "multiple devices open at once"

---

## 9. Game Completion & Admin Confirmation

- When a game finishes (all players ranked), it enters a **Pending Confirmation** state, visible only to the admin
- This applies to **every** completed game, including ones the admin personally played in — no auto-confirm exceptions
- Admin can **Confirm** or **Reject** each pending game:
  - **Confirm** → the game's points, captures, and sixes are added to global leaderboard totals, and it counts toward games played
  - **Reject** → the game is **hard-deleted**: removed entirely from the database, no audit trace, no leaderboard stat, and it disappears from participants' personal match history too — not just excluded from totals
- Until confirmed, participants can see their own result in their personal match history, tagged "pending confirmation"

---

## 10. Points System

Exact scoring table — use as-is, do not interpolate or derive a different scale:

| Players in game | 1st | 2nd | 3rd | 4th |
|---|---|---|---|---|
| 2 | 40 | 20 | — | — |
| 3 | 70 | 40 | 20 | — |
| 4 | 100 | 70 | 40 | 20 |

---

## 11. Stat Tracking (per player, all-time, confirmed games only)

- Total Points
- Games Played
- Wins (1st-place finishes)
- Win %
- Tokens Cut (total opponent captures, all-time)
- Sixes Rolled (total dice rolls landing on 6, all-time)

Every one of these must be logged per-game as it happens, but only added to a player's career totals **at the moment the admin confirms that game**. A rejected or cancelled game must leave zero trace on any leaderboard stat.

---

## 12. Leaderboard Page

8 columns, ranked by **Total Points**, high to low:

1. Rank
2. Player
3. Total Points
4. Games Played
5. Wins
6. Win %
7. Tokens Cut
8. Sixes Rolled

---

## 13. Development Process Rules — READ CAREFULLY

- **Build in phases.** Do not attempt the full application in one continuous pass. Follow the phase breakdown in Section 14.
- **Every phase is a two-gate cycle — plan gate, then review gate:**
  1. **Plan gate:** before writing any code for the phase, describe what you're about to build (scope, key files, approach) and stop. Wait for explicit approval before touching any code.
  2. **Build:** once approved, develop the phase.
  3. **Review gate:** stop again, report what was built, and give a **clear checklist of exactly what to review/test**. Wait for explicit sign-off.
  4. If the user gives feedback at either gate, keep iterating on the current phase — do not advance until they approve. Once approved, present the plan for the next phase (back to step 1) — do not proceed automatically.
- **Do not ask the user** about algorithms, libraries, internal code structure, or implementation approach — those are your decisions to make. The plan-gate description is a heads-up, not a request for the user to weigh in on implementation details.
- **Do ask the user** about visual/UX decisions before locking them in, as they come up within a phase: color palette specifics, token shape/style, board texture, dice animation style, movement/transition feel, typography, spacing and density.

---

## 14. Design Direction

- Modern, minimal, elegant — not a busy or cartoonish Ludo skin
- Clean typography, generous whitespace, restrained color palette, subtle motion only (no gimmicky animations)
- Mobile-first — most usage will be on phones
- **Performance and design quality are both non-negotiable.** Never trade one for the other — no janky animations to save time, no bloated assets that slow load.

---

## 15. Suggested Phase Breakdown

1. **Foundation** — DB schema, auth (login, JWT, roles), admin seed account
2. **Dashboard shell** — Player Dashboard, Manage Family (admin), Leaderboard page skeleton (no live data yet)
3. **Game creation flow** — Build the Game page, invites, accept/decline, start-at-2 logic, cancel-pending-on-start
4. **Core game engine** — board, tokens, dice, movement, classic rules, random colors, ranking logic
5. **Game lifecycle** — mid-game cancel, completion, admin Confirm/Reject queue, points + stat aggregation on confirm only
6. **Leaderboard wiring** — live 8-column table, sorting
7. **Visual/UX polish pass** — final aesthetic pass across all pages, motion, responsiveness

---

## 16. Explicitly Out of Scope (v2 / later)

- Accessibility polish (colorblind-safe palette, screen-reader labels, keyboard navigation)
- Push notifications or email notifications for invites
- Late-join or mid-game player addition
- Public/self-service registration
