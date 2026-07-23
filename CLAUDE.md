# Codec Ludo — Project Reference

> Renamed from "Family Ludo" in Phase 7 — **Codec Ludo** is the official name.
> The game is invite-only for anyone the admin adds, no longer framed as
> family-specific; spec references to "family" should be read as "members."

This file is a living explainer for the project, written for someone who wants to
understand every file and decision without writing code themselves. It gets updated
as each build phase lands. The authoritative requirements live in
`codec-ludo-prompt.md` — this file explains the *how* and *why* behind them.

## Status

Phases 1-5 are signed off (Foundation, Dashboard shell, game creation flow, core
game engine — including a long tail of follow-up polish rounds on Phase 4 — and
game lifecycle: mid-game cancel, admin Confirm/Reject, points/stat aggregation).
A same-day Phase 5 follow-up made usernames case-insensitive at login/creation
(like Gmail). Phase 6 (Leaderboard wiring) and Phase 7 (visual/UX polish +
the Codec Ludo rebrand, new app icon, Members Area rename, real About page)
are signed off, as is the pre-deployment hardening pass (debug tools removed,
code dedupe — see its section below). The GitHub repo is renamed to
`bunnycodec/codec_ludo`. **The app is LIVE in production** (2026-07-23) — see
the Deployment section at the bottom of this file. Remaining: pointing
ludo.bunnycodec.com at it (in progress).

Section 13 is now a **two-gate cycle per phase**: (1) plan gate — describe what's
about to be built and stop for approval, (2) build the phase, (3) review gate — stop,
report what was built with a review/test checklist, wait for sign-off, then present
the next phase's plan. No phase starts without an explicit go-ahead at the plan gate,
and no phase is considered done without explicit sign-off at the review gate.

Once a phase is signed off at the review gate, commit and push it before moving on —
each phase (and any same-day follow-up fixes made after sign-off) should land in git
as its own commit, not accumulate uncommitted across multiple phases.

## Tech stack (final) — and why

| Piece | Choice | Why |
|---|---|---|
| Frontend | React + Tailwind CSS | Component-based UI, utility-first styling — fast to build a clean, restrained design with |
| Realtime | python-socketio (Socket.io protocol), mounted into FastAPI via ASGI | Keeps a persistent two-way connection open between browser and server so moves/rolls push instantly, instead of the browser having to repeatedly ask "did anything happen?" Same protocol/JS client as standard Socket.io — no frontend impact from the backend language choice |
| Backend | Python + FastAPI | The user is an experienced Python developer and won't be writing code himself, so a backend he can read fluently directly serves his goal of understanding every file. FastAPI also auto-generates an interactive API docs page (Swagger UI) straight from the code — a live, browsable list of every endpoint and the exact data shape it expects |
| Database | Postgres (free tier via Neon or Supabase), accessed via SQLModel | Postgres lives outside the app server, so it survives redeploys/restarts — SQLite would need a *paid* persistent disk to not lose data. SQLModel (built by FastAPI's author) defines the DB table and the API schema from a single Python class, minimizing duplication when tracing data through the app |
| Auth | JWT in httpOnly cookies + bcrypt, one active session per account | Standard, secure session pattern. Single-session rule means logging in on a new device ends the old session — no two devices controlling the same account at once |
| Hosting | Render, free web service tier | $0/month. Tradeoff: the app sleeps after ~15 min idle and takes ~30-50s to wake on the next request. Acceptable because the family coordinates game timing over WhatsApp before playing anyway |
| Domain | User's existing domain, pointed at Render via CNAME | Done once the app is first deployed — turns `something.onrender.com` into a proper `ludo.yourdomain.com` |

## Glossary

Plain-language definitions of terms that will come up as the project gets built.

- **Hosting** — running your app on someone else's always-on computer (a server) so
  it's reachable by URL 24/7, instead of only running on your laptop.
- **Dependency** — someone else's code your project uses instead of writing from
  scratch (e.g. React, FastAPI). On the frontend, listed in `package.json` and
  downloaded into `node_modules` via `npm install`. On the Python backend, listed in
  `pyproject.toml` (or `requirements.txt`) and installed via `pip install`.
- **PaaS (Platform as a Service)** — a hosting company (Render, Railway) that handles
  the server/networking plumbing for you; you just hand them code and get a URL back.
- **Cold start** — the delay before a "sleeping" free-tier server wakes up to handle
  the first request after a period of no traffic.
- **Socket.io** — a library for keeping a persistent, two-way connection open between
  browser and server (built on WebSockets), so the server can push live events
  (dice rolled, token moved) instantly instead of the browser polling for them.
- **Server-authoritative** — the server decides what's true (dice results, whether a
  move is legal); the browser only displays what the server reports. Prevents a
  player from faking results by tampering with their own browser.
- **JWT (JSON Web Token)** — a signed token proving who's logged in, stored here in an
  httpOnly cookie (a cookie JavaScript in the browser can't read, which blocks a whole
  class of token-theft attacks).
- **ORM** — a library that lets backend code talk to the database using regular
  Python objects/classes instead of writing raw SQL by hand. This project uses
  SQLModel (see below).
- **Ephemeral filesystem** — a server's local disk that gets wiped on every
  deploy/restart. The reason SQLite was dropped in favor of Postgres (see table above).
- **FastAPI** — the Python web framework running the backend. You write functions,
  decorate them with the URL they respond to (e.g. `@app.post("/games/invite")`), and
  FastAPI handles turning HTTP requests into Python function calls and back.
- **Pydantic / SQLModel** — Pydantic is a Python library that validates data against a
  defined shape (e.g. "a Game must have a status that's one of these 4 values") and is
  what powers FastAPI's request/response checking. SQLModel builds on top of it to let
  one Python class double as both a database table definition and an API data shape —
  so there's a single place to look, not two, to see what a "Game" or "Player" record
  contains.
- **ASGI** — the standard interface Python web servers (like the one running FastAPI)
  use to talk to async Python code. Not something you need to touch directly — it's
  the plumbing that lets FastAPI and python-socketio share the same server process.
- **Uvicorn** — the web server program that actually listens on a network port and
  speaks HTTP to browsers. FastAPI is just Python logic and can't touch the network
  alone; uvicorn receives each request and hands it to FastAPI over ASGI, then sends
  the response back. Analogy: uvicorn is front-of-house (answers the door, carries
  plates), FastAPI is the kitchen (knows how to cook each dish). Same program runs in
  production on Render, just without `--reload`.
- **Virtual environment (`.venv`)** — an isolated folder holding this project's Python
  dependencies so they don't clash with other projects or the system Python.
  `source .venv/bin/activate` switches a terminal to use it (prompt shows `(.venv)`);
  alternatively prefix commands with `.venv/bin/`. It never starts anything itself.
- **async / await** — Python's syntax for code that can pause while waiting on
  something slow (a database query, a network call) without blocking the whole
  server. FastAPI is built around this. If your prior Python experience was mostly
  synchronous scripts, this is a genuinely new concept you'll see throughout the
  backend code, not a mistake or something overly clever.

## Phase 1 — what was built (backend/ folder)

Every backend file lives under `backend/app/`. Reading order for understanding:

1. `config.py` — settings loaded from env vars / `.env` (database URL, JWT secret, seed admin credentials)
2. `models.py` — the `User` table. Note `current_session_token`: the column powering one-active-session-per-account
3. `db.py` — database connection; `DATABASE_URL` decides SQLite (local dev) vs Postgres (production) with zero code changes
4. `auth.py` — bcrypt password hashing, JWT creation/verification, session-token generation
5. `deps.py` — route guards: `CurrentUser` (must be logged in, session must be current) and `AdminUser` (must also be admin)
6. `schemas.py` — exact JSON shapes each endpoint accepts/returns; secrets (hashes, tokens) are never in any response shape
7. `routes/auth.py` — login, logout, `/auth/me`, change-password
8. `routes/admin.py` — list users, create player account, reset a player's password,
   delete a player account (admin can't delete their own account)
9. `seed.py` — creates the first admin account at startup if none exists
10. `main.py` — wires it all together; startup runs `init_db()` + `seed_admin()`

Run locally: `cd backend && .venv/bin/uvicorn app.main:app --reload`, then open
http://127.0.0.1:8000/docs. Local dev uses a SQLite file (`ludo_dev.db`, git-ignored);
production will point `DATABASE_URL` at Neon/Supabase Postgres.

Key mechanism — single session: every login writes a fresh random token to the user's
DB row and embeds a copy in the JWT cookie. Every request compares the two; an older
login's copy no longer matches, so it gets a 401. Password change/reset also rotates
or clears the token, kicking out other devices.

## Phase 2 — what was built (frontend/ folder)

The React app, scaffolded with Vite (the standard build/dev tool for React). Design
direction agreed with the user: warm ivory background + deep pine green accent, the
four Ludo colors reserved for game meaning only, Nunito (friendly rounded) type.

Reading order for understanding, all under `frontend/`:

1. `vite.config.js` — dev-server proxy: browser calls `/auth`, `/admin`, `/health` on
   the frontend's own origin and Vite silently forwards them to FastAPI on port 8000
   (overridable via `BACKEND_URL` env var). Same-origin means the auth cookie flows
   automatically and the backend needs no CORS config
2. `src/index.css` — the whole design system: Tailwind v4 `@theme` tokens (colors,
   font) that become utility classes like `bg-pine`
3. `src/api.js` — every backend call in one file; throws `ApiError` with a
   human-readable message; fires a `session-expired` event on any unexpected 401
4. `src/auth.jsx` — app-wide login state (`AuthProvider`/`useAuth`), plus the route
   guards `RequireAuth` (redirects to /login, and forces temp-password accounts to
   /change-password) and `RequireAdmin`
5. `src/App.jsx` — route map; nesting mirrors the backend guards
6. `src/Layout.jsx` — shared top bar/nav; `src/components.jsx` — shared Card, Button,
   Field, notes, Logo
7. `src/pages/` — `Login`, `Dashboard` (placeholder stats/invites, disabled Create
   Game, admin-only Pending Confirmations card), `ChangePassword` (voluntary + forced
   modes), `ManageFamily` (fully live: list/add/reset/**delete**, delete has an
   inline confirm step and the backend blocks an admin deleting their own account),
   `Leaderboard` (8-column skeleton, empty state), `AboutDeveloper` (credits page,
   linked from the nav for everyone — currently a template with placeholder photo/
   bio/GitHub/LinkedIn, marked with a `TODO(refine)` in the file for the later pass
   once real content is supplied)

Run locally: backend as before, plus `cd frontend && npm run dev`, then open
http://localhost:5173. New concepts: JSX (HTML-like syntax inside JS), React context
(one shared login state any component can read), client-side routing (URL changes
without page reloads — the backend still enforces all auth on every request; the
frontend guards are purely UX).

## Phase 3 — what was built (game creation flow)

**Backend additions:**

1. `models.py` — two new tables. `Game` (creator, `status`: `pending` while
   collecting invite responses → `active` once started; `completed`/`cancelled`
   statuses are added in later phases). `GameInvite` — one row per invited player,
   `status`: `pending`/`accepted`/`declined`/`cancelled` (cancelled = still-pending
   when the creator hit Start, so the invite window closed on them).
2. `routes/users.py` (new) — `GET /users`: any logged-in player can see the family
   roster, needed to pick invitees. Distinct from admin-only `/admin/users`.
3. `routes/games.py` (new) — the whole flow:
   - `POST /games` — creator picks 2-4 players. If the creator includes themselves,
     that invite is auto-accepted (they obviously want to play if they picked
     themselves); everyone else gets a real `pending` invite. Only one draft game
     per creator at a time — keeps "resume my in-progress game" simple.
   - `GET /games/pending-invites` / `GET /games/pending-created` — feed the
     Dashboard's invite card and the Build Game page's "resume my draft" check.
   - `POST /games/{id}/invites/{invite_id}/accept` / `.../decline` — only the
     invited user can respond, and only once.
   - `POST /games/{id}/invites/{invite_id}/replace` — creator-only, swaps a
     *declined* invite for a different, not-already-in-the-game player and resets
     it to pending.
   - `POST /games/{id}/start` — creator-only, requires 2+ accepted, flips the game
     to `active`, and cancels any invite still sitting at `pending`.
   - `GET /games/waiting-to-start` — games this user accepted but the creator
     hasn't started yet (excludes games they created themselves — creators get the
     full waiting room instead, see below). Feeds the Dashboard's "waiting for the
     creator" status line.
   - `DELETE /games/{id}` ("end this room") — creator-only, only while still
     `pending`. Hard-deletes the game and every invite on it — nothing worth
     auditing for a game that never started. Every invitee's view of it (accepted
     or not) disappears the moment they next refresh.

**Frontend additions:**

- `pages/BuildGame.jsx` (new) — on load, checks for an existing draft game (so
  leaving and returning doesn't lose it); shows either the player picker or the
  live invite-status list with a **Refresh** button, per-declined-invite
  **Replace**, a **Start game** button disabled until 2+ have accepted, and an
  **End this room & start fresh** action (inline confirm, like the delete flow in
  Manage Family) that abandons the draft entirely.
- `pages/Dashboard.jsx` — the "Games" card (renamed from "Pending invites") now has
  two parts: invites that need your response (Accept/Decline), and games you've
  already accepted that are still waiting on the creator to start (status line
  only, no action). The **Create Game** button becomes **Enter Room** whenever you
  already have a draft game waiting for players, taking you straight back into it
  instead of a blank picker — this was a specific fix requested after the button
  felt "dirty" (same label regardless of whether a room already existed).
- No push/live updates anywhere in this flow — a deliberate, now-established
  pattern: the user explicitly chose a manual **Refresh** button over polling for
  all of this, matching the spec's no-notifications, WhatsApp-coordination
  philosophy. Apply the same default in later phases unless live updates are
  requested (the live game board itself may still want Socket.io per the original
  tech-stack call — ask, don't assume).

**Deliberately not yet built:** the actual board/dice/tokens. A started game just
flips to `active` with a confirmation message — Phase 4 gives it something to do.

## Phase 4 — what was built (core game engine)

The actual game: a live, playable board with dice, movement, captures, and
ranking, all per spec Section 6. This is also where Socket.io finally gets wired
in — the one place in the app with live push instead of manual refresh, since
instant dice/move updates are the entire reason this project chose Socket.io in
the first place (see the tech-stack table above). Confirmed with the user this is
the right call *specifically* for the board, distinct from invites which
deliberately stay refresh-only.

**Backend additions:**

1. `models.py` — a `Token` table (game, color, one of 4 indices, `position`: -1
   home yard / 0-50 shared track / 51-56 private home column, 56 = finished).
   `Game` gains `current_turn_user_id`, `dice_value`, `consecutive_sixes`.
   `GameInvite` gains `color`, `finished_at`, `rank`, `sixes_rolled`,
   `tokens_cut` — logged live as the game happens (spec Section 11), summed into
   career totals only when the admin confirms the game (Phase 5).
2. `ludo.py` (new) — the rules engine as plain, DB-free functions: legal-move
   calculation, the 8 safe squares (each color's entry + one star square per
   arm), capture detection, exact-count-to-finish, 6-to-leave-yard,
   extra-turn-on-6 / forfeit-on-third-six, turn rotation, and random color
   assignment. Kept separate from the routes specifically so it's easy to unit
   test in isolation (see the verification notes below) — no session, no
   HTTP, just ints in and decisions out.
3. `sockets.py` (new) — a `python-socketio` server mounted into FastAPI via ASGI
   (`main.py`'s exported `app` is now the Socket.io app wrapping the FastAPI
   app). Deliberately minimal: clients only ever *receive* a
   `board_updated: {game_id}` ping telling them to refetch — the payload isn't
   the board itself, because `my_movable_token_ids` is personalized per viewer
   and a single broadcast can't be correct for everyone in the room at once.
4. `routes/gameplay.py` (new) — `GET /games/{id}/board` (personalized board
   state), `POST /games/{id}/roll`, `POST /games/{id}/move`. All plain REST, not
   socket events — after a roll/move changes the board, the route broadcasts the
   refetch ping. Much simpler to test than accepting game actions over the
   socket itself.
5. `routes/games.py` — `start_game` now randomly assigns colors and creates each
   player's 4 tokens the moment a game goes active; new `GET
   /games/active-for-me` feeds the Dashboard's "Enter Room" button so it can
   route into a live game, not just a pre-start draft (closes the gap flagged at
   the Phase 3 review).

**Frontend additions:**

- `boardLayout.js` (new) — maps the backend's abstract token positions onto a
  classic 15x15 board. Only Red's own arm/home-column/yard is hand-placed; the
  other three colors are generated by rotating Red's cells 90° at a time around
  the board center, since the board has exact 4-fold rotational symmetry. This
  guarantees the four corners line up correctly by construction, instead of
  risking a mistake hand-transcribing four near-identical coordinate lists.
- `socket.js` (new) — thin `socket.io-client` wrapper: connect, join a game's
  room, refetch on `board_updated`.
- `pages/GamePage.jsx` (new, route `/game/:gameId`) — the board itself: 15x15
  grid, dice, turn banner, click-to-move (only legal tokens are highlighted —
  the server decides legality, this just displays `my_movable_token_ids`),
  final standings once the game completes. Up to 4 tokens sharing one cell are
  laid out in a small 2x2 sub-grid rather than a diagonal stack, so each stays
  individually clickable.
- `pages/Dashboard.jsx` / `pages/BuildGame.jsx` — **Enter Room** now checks for
  an *active* game first (highest priority), then a pending draft, then plain
  **Create Game**; starting a game now navigates straight into the board instead
  of showing a static "Game started!" card. The "one game at a time" rule from
  Phase 3 (disable Create Game once you've accepted an invite elsewhere) now
  also accounts for games that have gone active, not just pending drafts.

**How this was verified** (no automated test suite exists yet, so this was done
by hand): a full random playthrough via a script driving the REST API directly
(hundreds of turns to natural completion, checking captures/extra-turns/ranking
along the way); direct unit tests of every rule in `ludo.py` in isolation (safe
squares, exact-finish, 6-to-leave-yard, turn wraparound, color assignment);
targeted API-level tests forcing the three-consecutive-sixes forfeit and illegal
moves; a Socket.io client script confirming the broadcast actually fires; and a
two-browser Playwright run (via `chromium`) proving one player's moves appear on
the *other* player's screen without that player touching anything — the live-push
guarantee working end to end. One real bug was caught and fixed this way: ranking
was off-by-one due to SQLAlchemy's autoflush including a player's own
just-finished row in its own "how many finished before me" count.

**Known gap, flagged rather than silently skipped:** the board is functionally
complete and rules-correct, but visually plain — flat colors, thin home-column
lines, no textures/icons. Spec Section 14 reserves a dedicated "Visual/UX polish
pass" for Phase 7, so this was left intentionally minimal rather than over-built
now. Flag if you'd like some of that polish pulled forward.

### Phase 4 follow-up fixes (same day)

Three rounds of user feedback after the initial Phase 4 review:

1. **Board redesign.** The original board (thin colored lines) read as "not a
   Ludo board." Rebuilt to match a classic board's look: each yard is now one
   solid color block (not 36 individually-bordered tiny squares) with a
   floating white card holding the 4 token slots, added as a single spanning
   grid item rather than per-cell styling. The center 3x3 got a genuine
   4-color pinwheel via one `conic-gradient` div (`from -45deg`, so the wedge
   seams land on the block's diagonals — colors ordered `CENTER_PINWHEEL_ORDER`
   in `boardLayout.js`, derived from which color's home column approaches
   center from which side). Safe squares now show a star icon instead of a
   plain dot. Track tokens moved from per-cell nested divs to one
   percentage-positioned absolute overlay, which incidentally fixed a real
   click-target bug: multiple same-cell tokens previously stacked diagonally
   and the top one covered the ones underneath, making them unclickable.
2. **Dice became the control.** The separate "Roll Dice" button is gone — the
   die itself is now the button, enabled only when it's your turn and no roll
   is pending. Rolling plays a client-side tumble (cycling random faces ~640ms)
   before settling on the server's real value. This required a real backend
   fix, not just frontend animation: a roll that immediately auto-passes the
   turn (a non-6 with nothing to move) cleared `dice_value` to `null` in the
   very same response, so the player who rolled would never actually see what
   they got. Fixed by adding `Game.last_roll_value` (what to display — persists
   until the next roll, independent of whether that roll is still "pending")
   and `Game.roll_sequence` (increments on every roll; the frontend watches
   *this*, not the value, since comparing values alone misses it whenever the
   same face comes up twice in a row across different players' turns). Every
   client watching the game — not just whoever clicked — plays the same tumble
   the instant their next board refetch shows a new `roll_sequence`, which is
   what makes a roll feel shared at the table.

**A recurring gotcha worth remembering:** `SQLModel.metadata.create_all()`
(called by `init_db()` at startup) only creates tables that don't exist yet —
it never adds columns to a table that's already there. Every Phase 4 model
change that touched `Game` or `GameInvite` (both pre-existing since Phase 3)
needed a manual `ALTER TABLE` against the local dev SQLite file
(`backend/ludo_dev.db`) to actually take effect; new tables like `Token` don't
have this problem since `create_all` does create brand-new tables normally.
This project has no migration tool (Alembic or similar) set up. Until it does,
any future change to an *existing* table's columns will need this same manual
fix — check for it if a previously-working feature suddenly throws a vague
"Something went wrong" after a schema change.

3. **Layout pass on the same board/game screen.** The status card, dice-roll
   button, and separate Players list all got removed in favor of putting the
   information directly on the board: the board itself now fills the
   available width (no `max-w` cap); the dice moved to a small control pinned
   to the board's own top-right corner (`absolute` inside the board container)
   instead of sitting in a card above it; each yard card shows that player's
   username directly; and whose turn it is now shows as a highlight on that
   player's yard rather than a text banner. Two things worth remembering if
   touching this again:
   - A same-colored glow is invisible against that color's own yard
     background (a red glow barely shows against the red yard). The working
     turn-indicator is a neutral white-then-black double ring plus a slight
     scale-up — high contrast against all four yard colors, not just some.
   - Tailwind v4 generates `scale-*` utilities using the modern standalone CSS
     `scale` property, not `transform: scale(...)`. `getComputedStyle(el).transform`
     will misleadingly read `"none"` even when a `scale-*` class is correctly
     applied and working — check `getComputedStyle(el).scale` instead, or set
     it via inline `style.transform` directly (what's currently in the code)
     to sidestep the question entirely.

4. **Full redesign** — the on-board turn ring from fix #3 got reverted the same
   day; the user wanted the board itself kept clean with no information
   painted onto it at all. This was the biggest visual pass of Phase 4:
   - **Turn/name info moved off the board entirely**, into a new `TurnPanel`
     — a row of player chips above the board, the active one filled solid in
     their color. The board no longer shows names or a turn highlight.
   - **Dice moved into the board's own center** — a clean white square
     spanning the middle 3x3 (where the pinwheel used to be; the pinwheel is
     gone) with the die centered inside it, rather than a corner-pinned
     overlay.
   - **Tokens became pawn shapes** (`PawnShape` in GamePage.jsx) — built from
     plain SVG primitives (base ellipse, tapered body path, neck ring, head
     circle), not one hand-tuned path, specifically to avoid an
     unpredictable/ugly result from freehand bezier tuning. The white outline
     comes from layered `drop-shadow()` filters on the whole icon rather than
     a stroke on each sub-shape, which would leave visible seams where the
     pieces meet.
   - **Every token now renders through one function**, `tokenPercent()` in
     `boardLayout.js`, returning board-wide percentages regardless of whether
     the token is parked in a yard or out on the track. This is what makes
     smooth movement possible: since it's the same DOM node (keyed by
     `token.id`) moving between two percentage values, a plain CSS
     `transition` on `left`/`top` makes the move glide — including a yard exit
     or a capture snapping a token back home, not just ordinary track steps.
     Verified by sampling `getComputedStyle().left` mid-transition and
     confirming it sits strictly between the before/after values (an instant
     jump would show mid === after).
   - **Yard card spacing became exact instead of eyeballed** — `yardCardRect()`
     computes the white card's position from one named margin constant
     (`YARD_CARD_MARGIN_CELLS`), so all four corners are provably symmetric
     rather than approximated via a CSS grid-span + margin combo.
   - **Dice tumble became a real 3D rotation** — `@keyframes dice-tumble` in
     `index.css` animates `rotateX`/`rotateY` on the die (needs `perspective`
     on its parent to read as 3D rather than a flat spin), while the JS tick
     loop still swaps the displayed pip count mid-animation. Confirmed via
     `getComputedStyle().transform` returning a `matrix3d(...)` mid-roll — on
     *both* the roller's screen and another connected player's screen, proving
     the tumble is genuinely 3D and genuinely shared, not just cosmetic on
     whoever clicked.
   - **A real sizing bug caught during this pass**: the die's `perspective`
     wrapper had no explicit height. Since the die's pip content is 100%
     `position: absolute` (pips contribute zero intrinsic height to their
     normal-flow parent), and the wrapper's height was `auto` depending on
     that same zero-height content, the two collapsed to ~4px the moment an
     actual number was displayed — the "?" placeholder before any roll is
     ordinary inline text, so it has real height and masked the bug in every
     screenshot taken before the first roll. Fixed with an explicit
     `h-full w-full` on the wrapper to break the circular sizing dependency.

5. **A fifth round, refining several things from round 4 at once** — the
   turn/name panel from round 3 stayed (explicitly confirmed as "great, keep
   it"), but almost everything else got another pass:
   - **The dice became a genuine 6-face 3D cube** (`transform-style:
     preserve-3d`, each face placed with `translateZ`), replacing the flat
     single-face rotateX/rotateY from round 3 — that read as "weird 2D"
     according to feedback, since a flat plane spinning isn't the same as a
     cube tumbling. Rolling now just sets the cube's absolute target rotation
     (current angle + whatever's needed to bring the rolled face to front,
     plus a couple of extra full spins for a satisfying tumble) and lets the
     browser's own transform interpolation show genuine faces passing by in
     transit — confirmed via `getComputedStyle().transform` returning
     `matrix3d(...)` with real off-axis values, and visually (a screenshot
     mid-roll shows two cube faces at an angle, like an actual die). The old
     JS tick-loop that randomly swapped a flat face's pip count is gone
     entirely — a real cube doesn't need it, the rotation itself provides the
     "which face is showing" effect.
   - **The center square is a 4-color pinwheel again** (`conic-gradient`,
     `CENTER_PINWHEEL_ORDER` in `boardLayout.js`), with the dice cube sitting
     on top of it — the plain white square from round 4 read as too bare.
   - **Yard cards shrank** — `YARD_CARD_MARGIN_CELLS` in `boardLayout.js` went
     from `0.55` to `1.05`; round 3's tightened margin ended up looking
     oversized for holding just 4 pieces.
   - **Tokens shrank too** (5% of board width, down from 6.6%), and the
     movable-token indicator changed from a hard `ring-2` outline to a soft
     pulsing radial-gradient glow behind the pawn — "light them, don't circle
     them."
   - **Pawns got redesigned** from a 4-primitive shape with a
     layered-drop-shadow outline to a simpler 3-primitive shape (a tapered
     body path, a thin collar line, a head circle) with a solid dark stroke
     outline instead — closer to a reference image the user provided of a
     classic minimal pawn silhouette.
   - **Token movement now follows the actual board path instead of tweening a
     straight line between old and new position.** This was the most involved
     change: `buildMovePath()` in GamePage.jsx walks every intermediate
     position between a token's old and new value (position numbers are
     already a single linear 0-56 range per color covering the shared track
     *and* the home column, so "step through every integer in between" is all
     it takes) and converts each to board coordinates via `trackPercent()`/
     `yardSlotPercent()` (both now exported from `boardLayout.js` for this).
     A `useEffect` diffs each token's real position against what it was on
     the previous board update and, on a change, steps the token through that
     full path via `setInterval`, relying on a plain CSS `left`/`top`
     transition to glide smoothly *between* each pair of consecutive steps.
     A capture reverses the same path back to the entry square and into the
     yard slot, at a fixed total duration (~420ms, faster regardless of how
     far the token had traveled) rather than the forward move's fixed
     per-step pace. Verified two ways: sampling `getComputedStyle().left`
     across several frames of a real 4-step move and confirming it holds
     *exactly* constant while `top` changes (proving the token stayed in its
     track column rather than cutting diagonally), and — since coordinating a
     live capture through the socket layer for a one-off check wasn't worth
     the complexity — directly exercising the reverse-path math with a
     representative capture scenario and confirming the resulting path lands
     inside the correct yard card's bounds.
   - One real bug caught while building this: the very first cap on how many
     steps to animate before "just snap instead" (`MAX_ANIMATED_STEPS = 24`,
     shared by both directions) was fine for a forward move (never more than
     6) but far too low for a capture's reverse trip, which can legitimately
     span the *entire* board (~50 cells for a token caught right before
     finishing) — that would have silently skipped the capture animation for
     any moderately-progressed token. Split into `MAX_FORWARD_STEPS = 10`
     (generous headroom above the real max of 6, catching only genuinely
     stale multi-turn-missed diffs) and `MAX_RETURN_STEPS = 60` (covers the
     full legitimate range).

6. **A sixth round** (2026-07-20), covering glow visibility, mid-game quit, and
   a mobile pass:
   - **Movable-token glow got a contrast fix.** The old glow was a low-opacity
     pine radial gradient — too close in hue to `ludo-green` and too subtle
     against several backgrounds to read clearly. Replaced with a
     white-core/dark-ink-ring halo (`Pawn` in GamePage.jsx) that's neutral
     relative to all four Ludo colors, so it doesn't quietly disappear behind
     a same-hued token or a light track cell.
   - **A self-serve "Exit Game" for any player was requested but not
     built** — it directly contradicts spec Section 7 ("Do not build an
     in-app leave/forfeit feature"). Flagged to the user; they chose to keep
     the spec as-is rather than override it, so there's still no in-app way
     for a regular player to leave mid-game — that stays a WhatsApp-coordinate-
     with-the-creator situation.
   - **Creator-only "Quit Game" was built** (this *does* match spec Section
     7 — creator/admin can cancel an in-progress game). `GameStatus` gained a
     `cancelled` value; `POST /games/{id}/cancel` (routes/games.py,
     creator-only, active-only) clears turn/dice state and broadcasts the
     usual `board_updated` ping. `GET /games/{id}/board` now also accepts a
     cancelled game (previously only active/completed) so every participant's
     next refetch — live via the socket ping, no action needed on their end —
     shows a "Game Cancelled" card instead of the board controls. This is a
     small slice of Phase 5 (mid-game cancel) pulled forward; the rest of
     Phase 5 (admin Confirm/Reject queue, points/stat aggregation) is still
     ahead. No manual `ALTER TABLE` was needed for the new `cancelled` value —
     unlike the *new-column* gotcha logged in Phase 4, this widens an
     existing plain-VARCHAR `status` column's set of valid values, which
     SQLite doesn't enforce at the schema level.
   - **A real bug caught during testing**: the first cut of the Quit Game
     handler did `setBoard(await api.cancelGame(gameId))`, but the cancel
     endpoint's response model is `GameOut` (creator/invites shape), not the
     `BoardOut` shape (players/tokens/my_movable_token_ids) the rest of
     GamePage reads — it crashed the whole page (`board.players.filter` on
     `undefined`) the instant a creator actually clicked quit. Fixed by
     calling the existing `refresh()` (a plain `GET /board` refetch) after
     the cancel call succeeds, instead of trusting the mutation response's
     shape. Caught by driving a real two-account game via the API and
     clicking through the actual button in a browser rather than only
     reasoning about the endpoint in isolation — worth remembering given this
     project still has no automated test suite.
   - **Mobile pass**: the top nav (`Layout.jsx`) was the one real gap — on a
     narrow phone width, "Dashboard / Leaderboard / Family (admin) / About /
     Log Out" together are wider than the screen, and the `nav` element had
     no `flex-wrap` of its own (only its parent header did), so it would
     overflow instead of wrapping to a second line. Fixed by adding
     `flex-wrap` to the `nav` itself. Everything else checked out already
     mobile-fine by construction: the board is percentage/aspect-ratio based
     with no fixed pixel widths anywhere in the frontend, the Dashboard stats
     grid already steps down to 2 columns below the `sm` breakpoint, and the
     Leaderboard's wide table already scrolls sideways inside its own
     `overflow-x-auto` wrapper rather than stretching the page (both from
     earlier phases). Verified via a live two-account browser session
     (glow contrast, the full quit flow including the crash above, and the
     live socket push landing on a second, non-creator account) plus a
     static pass over every page's layout classes for wrap/overflow gaps;
     a true narrow-viewport screenshot pass was cut short mid-session by
     repeated claude-in-chrome extension disconnects and not retried.

7. **A seventh round** (2026-07-20, same day): a real animation bug fix, a
   cancelled-game screen redesign, and a new testing-only tool.
   - **Token move animation glitch, fixed.** Reported as "the token moves
     fast to the final box, then comes back and animates the 4 steps again."
     Root cause: the effect that sets up `animatingTokens` (GamePage.jsx) was
     a plain `useEffect`, which runs *after* React paints. The render right
     after a move's `setBoard()` had no `animatingTokens` entry yet for the
     moved token, so it painted once at the token's real final position with
     no transition (the "fast jump"); only then did the effect run and set
     the first path step, animating *backward* from the final position to
     the path's start before replaying forward (the "coming back"). Fixed by
     switching that effect to `useLayoutEffect`, which runs before paint —
     React now reconciles the animated first-step position before the
     browser ever paints the raw final-position frame, so only the smooth
     path animation is ever visible.
   - **Cancelled-game screen simplified.** Previously showed the "Game
     Cancelled" message card with the (frozen) board still rendered
     underneath, matching how a completed game shows standings-above-board.
     Per feedback this was changed to an early return: a cancelled game now
     renders *only* the message card plus a "Go to Dashboard" button — no
     board at all, for any viewer.
   - **New testing-only tool: forced dice rolls.** Admin-only
     `POST /debug/force-dice/{1-6}` (routes/debug.py) sets a one-shot
     override consumed by the next `ludo.roll_dice()` call, then reverts to
     real randomness. Built specifically to be deleted cleanly later: it's
     fully isolated to routes/debug.py, one small marked block in
     `app/ludo.py`, and two lines in `main.py` (both flagged "TESTING ONLY"
     in comments) — deleting those three things removes the feature with no
     leftover references anywhere else. Verified via curl/requests against a
     scratch backend: non-admin gets 403, a forced value is reflected exactly
     on the next roll, and an out-of-range value is rejected (422) before it
     reaches app logic.
   - **Process change**: manual UI verification no longer happens via
     claude-in-chrome — the extension proved unreliable mid-session in the
     prior round. Going forward, UI-visible changes get verified by
     build/lint plus code-level reasoning, and a concrete "what to check"
     checklist is handed to the user instead of Claude driving a browser.

8. **An eighth round** (2026-07-21): a real proxy bug, and a batch of board
   visual/motion tweaks, several revised more than once as feedback came in.
   - **Real bug**: the forced-dice testing button threw "Something went
     wrong" the first time it was clicked. Cause: `vite.config.js`'s dev
     proxy list never included `/debug`, so the request was handled by Vite
     itself (which has no such route) instead of being forwarded to FastAPI.
     Fixed by adding `/debug` to the proxy map alongside the other prefixes;
     verified end-to-end by hitting the exact frontend-origin path with curl
     through the proxy, not just the backend directly.
   - **Movable-token glow → "shine."** The circular halo behind a movable
     token is gone; the pawn itself now pulses `brightness()` +
     `drop-shadow()` (`.animate-token-shine` in index.css), so the glow
     follows the pawn's own silhouette instead of a separate shape.
   - **Star squares recolored, then refined twice more.** Each color has 2
     star squares (entry square + one 8 steps into the arm); both were
     confirmed (via actual cell-adjacency computation, not assumed) to touch
     that color's own yard. Landed on: the *entry* square gets a colored
     cell background with a dark star icon (unchanged since first pass);
     the *other* star keeps a normal white cell but its star icon itself is
     colored to match the house. Star icon size was also tuned down from an
     initial 70%-of-cell (too big) to 50% (medium) after feedback, and
     switched from a fixed pixel size to percentage-of-cell so it scales
     with the board instead of looking disproportionate at different sizes.
   - **A "HOME" label was tried in 3 different places and ultimately
     dropped.** First across the whole home-column stretch (rejected —
     wanted it only at the actual finish point). Then narrowed to just the
     single finish cell (rejected as invisible — a 7px label boxed into one
     ~6.67%-wide cell was too cramped to read). Then widened/enlarged with
     no box constraint (still invisible) — root cause turned out to be
     structural, not sizing: each color's finish cell sits at one of the
     four edge-middle positions *inside* the 3x3 center pinwheel block, and
     the pinwheel `<div>` renders after it in DOM order with a solid
     gradient background, fully covering anything under it at that spot.
     Removed entirely rather than fighting that stacking order.
   - **Same-cell token stacking**: tried replacing the 4-direction diamond
     scatter with a single-diagonal cascade (meant to read more like a
     fanned stack), but reverted byte-for-byte on request — the original
     diamond pattern was preferred once compared side by side.
   - **Dice now visually shows whose turn it is** — dimmed + grayscale when
     it isn't your turn, a pulsing pine-colored ring (`.animate-dice-glow`)
     for your *entire* turn (not just the pre-roll instant) via a new
     `active` prop on `DiceCube`, kept deliberately separate from the
     existing `clickable` prop (which still only governs whether a click
     currently does anything).
   - **Real bug in capture timing, fixed.** A captured token's trip back to
     the yard used to start in the exact same instant as the capturing
     token's forward move — both animations began together, so the
     capture looked like it fled before the capturing token ever arrived.
     The token-animation effect in GamePage.jsx now does two passes: movers
     (tokens landing on a non-yard position) start immediately as before;
     any token sent to the yard (-1) in that same update is understood to
     have been captured by whichever token just moved (a capture always
     lands on the exact square being vacated), and its own animation is
     scheduled via `setTimeout` to start exactly when the capturing move's
     animation finishes — no added pause, just correct sequencing.

## Phase 5 — what was built (admin Confirm/Reject, points & career stats)

Mid-game cancel (spec Section 7) was already done as a Phase 4 follow-up (see round
7 above); this phase is the rest of spec Section 9: every completed game sits in a
**Pending Confirmation** state until the admin acts on it — **Confirm** adds its
points/tokens-cut/sixes-rolled to each participant's career totals and counts toward
games played; **Reject** hard-deletes the game, its invites, and its tokens, leaving
zero trace anywhere (mirrors the existing "End Room" pattern for abandoned drafts).

**Backend:**

1. `models.py` — `User` gains 5 career-total columns (`total_points`,
   `games_played`, `wins`, `tokens_cut`, `sixes_rolled`, all starting at 0). Win %
   is deliberately *not* stored — always derived from wins/games_played wherever
   it's shown, so it can never drift out of sync. `Game` gains `confirmed_at:
   datetime | None` — distinguishes "completed, still in the queue" (`None`) from
   "completed, already reviewed," without needing a new status enum value (a
   rejected game never reaches this field at all — it's deleted instead).
2. `ludo.py` — `POINTS_TABLE` + `points_for_rank(player_count, rank)`, the exact
   scoring table from spec Section 10 (2p: 40/20, 3p: 70/40/20, 4p: 100/70/40/20),
   as a pure lookup — only ever called at confirm time, never stored until then.
3. `routes/games.py` — `GET /games/pending-confirmation` (admin-only, every
   completed+unconfirmed game with a per-player points-if-confirmed preview),
   `GET /games/my-pending-confirmation` (a participant's own awaiting-confirmation
   results, spec Section 9's "tagged pending confirmation" requirement),
   `POST /games/{id}/confirm`, `POST /games/{id}/reject`. The two new GET routes
   had to be inserted *before* the existing bare `GET /{game_id}` route earlier in
   the file, not appended at the end where they were first written — FastAPI
   matches routes in registration order, and `/{game_id}` (typed `int` in the
   function signature, but matched as "any string" at the routing layer since the
   path string itself has no `:int` converter) would otherwise have swallowed
   `GET /games/pending-confirmation` first and failed trying to parse
   "pending-confirmation" as an id. The existing `/pending-invites`,
   `/pending-created`, etc. already followed this ordering rule; the new routes
   now do too.
4. `routes/users.py` — `GET /users/me/stats`, deliberately **not** added as fields
   on `UserOut` itself, since `UserOut` is embedded all over the place (game
   invites, the family roster, admin's user list) that has no reason to carry
   stats. A dedicated `UserStatsOut` keeps that general-purpose shape lean.
5. `routes/gameplay.py` — `BoardOut` gains `confirmed_at` too, so the Final
   Standings screen can say something more accurate than "waiting on the admin"
   forever once a game actually gets confirmed.

**Frontend (`Dashboard.jsx` only — no new pages):**

- **"Your Stats"** now shows real numbers from `GET /users/me/stats` instead of
  hardcoded zeros.
- **"Pending Confirmations"** (admin-only) is wired to the real queue: each
  game shows every player's rank, points-if-confirmed, tokens cut, and sixes
  rolled; **Confirm** is a direct one-click action (not destructive), **Reject**
  gets the same inline double-confirm pattern used for Delete/End Room/Quit Game
  elsewhere, since it's an irreversible hard delete.
- **"Games"** gained a third section beyond invites-needing-response and
  waiting-on-creator: a participant's own completed-but-unconfirmed results,
  tagged "Pending Confirmation" — this is the regular-player-facing half of spec
  Section 9, distinct from the admin's own queue card.

**A real incident during this build, worth remembering:** the two new columns on
`User` and the one on `Game` are the usual "new column on an *existing* table"
case this project has hit before (`SQLModel.metadata.create_all()` never adds
columns to a table that already exists) — but this time, editing `models.py`
alone was enough to take the live dev server down. The backend runs with
`uvicorn --reload`, which restarts the app the moment a source file changes; the
restart's own startup sequence (`seed_admin()`) immediately queries the `User`
table, and with the new columns only in the Python model — not yet in the actual
SQLite file — every one of those queries started failing, hanging the whole
process rather than erroring cleanly. The dev server had to be force-killed and
restarted by hand after the migration was applied. **The fix going forward: run
the `ALTER TABLE` in the very same step as the model edit, before moving on to
anything else** — not "later once the rest of the phase is built," which is what
happened here.

**How this was verified:** end-to-end against a scratch backend/DB (never the
user's real one) — two real games driven through the actual API and instantly
completed via the Phase 4 debug tool, then: non-admin correctly gets 403 on every
new endpoint; confirming one game produces exactly the spec's point values (a
2-player game: 40/20) and updates `games_played`/`wins`/`win_percentage`/
`tokens_cut`/`sixes_rolled` precisely; the confirmed game's board correctly
reflects `confirmed_at`; confirming the same game twice is rejected; rejecting the
other game hard-deletes it (subsequent `GET` on it returns 404) with zero effect
on anyone's stats. Once the schema fix above restored the user's real dev server,
the same manual checks (reading the real SQLite file directly) confirmed all 4
real family accounts were untouched and defaulted to 0, and that the user's own
earlier "Finish Game Now" test game was sitting there as valid, well-formed data
ready to exercise the real Confirm/Reject flow live.

### Phase 5 follow-up (same day): case-insensitive usernames

Login and account creation both now match usernames case-insensitively, like
Gmail — "Alice", "alice", and "ALICE" all resolve to the same account, and
creating a duplicate that only differs by case is rejected. Implemented as
`func.lower(User.username) == body.username.lower()` at the two places that
ever matched a username (`routes/auth.py`'s login, `routes/admin.py`'s
create_user) — the stored value keeps whatever casing the admin originally
typed, since only the *comparison* changed, not the data. No DB-level
collation/index change: a case-collision race is essentially impossible in
this app's usage pattern (one admin, creating accounts one at a time, no
public self-registration), so the app-level check alone is sufficient without
the added risk of another schema change so soon after the Phase 5 incident
below. Verified against a scratch backend: all four casings of a username log
into the same account, duplicates rejected regardless of case, original
casing preserved for display.

## Phase 6 — what was built (Leaderboard wiring)

The global Leaderboard page (spec Section 12), wired to real data for the first
time — previously a static skeleton with a permanently-empty table.

**Backend:**

1. `routes/leaderboard.py` (new) — `GET /leaderboard`, every registered user
   (including accounts that haven't played yet, showing all zeros — a deliberate
   choice, confirmed with the user rather than assumed, over only listing players
   with at least one confirmed game) sorted by Total Points descending, with a
   `rank` computed using standard competition ranking: tied scores share a rank,
   and the next distinct score skips accordingly (e.g. 1, 1, 3) rather than every
   row incrementing regardless of ties. Verified against a scratch backend with a
   deliberately constructed tie (two players landing on the same total) — both
   correctly showed the same rank, and the next entry correctly skipped to 5, not 4.
2. `schemas.py` — `LeaderboardEntryOut`, deliberately flat (no nested `UserOut`)
   since every consumer just needs one row to render.
3. This phase needed **zero database changes** — every field it reads
   (`total_points`, `games_played`, etc.) already existed from Phase 5. Worth
   noting given the Phase 5 migration incident: a phase that only *reads*
   existing columns carries none of that risk, unlike one that adds new ones.

**Frontend (`Leaderboard.jsx`):**

- Real rows instead of a permanently-empty table, plus a manual **Refresh**
  button — matching the app's established refresh-on-demand pattern (stats only
  change via an admin action elsewhere, not something worth polling for).
- Clickable column headers re-sort the *view* by any column (click "Wins" to see
  who's won the most, click again to flip direction) — the **Rank** column
  itself never changes when sorting by something else, so "who's actually
  winning overall" stays answerable regardless of which column the table is
  currently sorted by for browsing. `win_percentage` nulls (no games played
  yet) always sort last regardless of direction, rather than being treated as
  0 and landing at the top of an ascending sort.
- The logged-in viewer's own row gets a subtle background tint, so a family
  member can spot themselves in the table at a glance without scanning every row.

**A gotcha caught and fixed before it became a repeat of the Phase 5
incident**: `vite.config.js`'s dev-server proxy needed `/leaderboard` added
alongside the other path prefixes, or the frontend's request would be
swallowed by Vite itself instead of reaching FastAPI — the exact same class of
bug as the `/debug` proxy omission from an earlier round. Caught proactively
this time by checking the proxy list the moment the new route was added,
before it ever shipped, rather than after a "something went wrong" report.

## Phase 7 — what was built (rebrand + visual/UX polish pass)

The final phase from spec Section 15, combined with a set of identity changes
the user requested at the same time.

**Rebrand: Family Ludo → Codec Ludo (official name).** `index.html` title,
the Layout header, the Login page, and the backend's `FastAPI(title=...)` all
say "Codec Ludo" now. The framing shifted from family-specific to
invite-only-for-anyone: the admin still creates every account (unchanged
mechanics), but the copy no longer assumes players are family.

**New app icon.** The old pine-green square camouflaged against the app's own
green accent (user complaint). The new mark — in both `public/favicon.svg`
and the `Logo` component in `components.jsx`, which must be kept in sync by
hand — is a die showing five on a warm dark-ink square: four pips in the four
Ludo colors, white center pip. Reads as a board-game die at favicon size and
contrasts with every app surface.

**Members Area (was Manage Family).** `pages/ManageFamily.jsx` →
`pages/MembersArea.jsx` (git mv, so history follows), route `/family` →
`/members`, nav label "Members Area", card titles "Add a Member"/"Members".
Backend route *paths* are untouched (`/users`, `/admin/users`) — only
docstrings, the `list_members` function name, and the frontend
`api.listMembers()` name changed, so nothing breaks for existing sessions.
`BuildGame.jsx`'s internal `family` variables became `members` to match.

**About page went live** (`AboutDeveloper.jsx`). Real content: Sunny Kumar's
photo (web-optimized 512px square crop at `src/assets/developer.jpg` — the
full-res original lives in the git-ignored `Archive/` folder and never gets
committed), GitHub/LinkedIn/Website links, an honest credits paragraph
(architecture and design by Sunny; Claude Code actively used during coding —
deliberately no "hand-built" overclaim, at the user's explicit direction),
and a short "About Codec Ludo" card describing the game. The page's template
scaffolding (null-URL placeholder states, TODO markers) was removed.

**Motion/polish.** A single subtle page-entry animation (`.animate-page-rise`
in `index.css`: 0.28s fade + 6px rise) plays on every navigation — applied in
`Layout.jsx` via a wrapper `div` keyed by `location.pathname` (the key is
what makes it replay per route change; an unkeyed wrapper would animate once
per login). Login's two blocks use the same class. Buttons gained a slight
`active:scale-[0.98]` press; Field/Select gained a soft focus ring
(`ring-pine/15`) with a border/shadow transition. Deliberately nothing more —
spec Section 14 forbids gimmicky animation, and the board already has its own
motion system from Phase 4.

**Verified via** `npm run build` (clean) and checking the running backend's
`/openapi.json` title. ESLint turned out to not actually be configured in
this project (no flat-config file) — flagged rather than silently skipped;
worth setting up someday but not a Phase 7 concern.

## Pre-deployment hardening (after Phase 7, before deploy)

Requested as "make it production ready" ahead of the Render deployment.

**The testing-only debug tools are gone.** Force-dice and finish-now would
have let any admin rig or skip real games in production. The Phase-4-era
design goal of "built for clean deletion" paid off: `routes/debug.py`
deleted, the forced-roll block in `ludo.py` collapsed back to a one-line
`roll_dice()`, two wiring lines out of `main.py`, the `/debug` proxy line
out of `vite.config.js`, `forceDice`/`finishGameNow` out of `api.js`, and
the force-roll button row + handlers out of `GamePage.jsx`. Verified against
the running server: `/debug/*` returns 404 and the OpenAPI route list
contains no debug paths. Tradeoff, stated openly: future manual testing
loses dice control — if that hurts later, the git history has the full
feature to resurrect temporarily on a branch.

**Deduplication pass:**

- `ConfirmBar` (components.jsx) — the inline red confirm strip was hand-built
  four times (delete member, reject game, end room, quit game); now one
  shared component. Purely presentational extraction, no behavior change.
- `Loading` (components.jsx) — the repeated "Loading…" paragraph, now shared
  (GamePage keeps its distinct "Loading board…" text).
- `LeaderboardEntryOut` now inherits `UserStatsOut` instead of repeating all
  six stat fields; the JSON wire shape is unchanged (verified via the
  OpenAPI schema's required-field list before/after).
- The Leaderboard page's empty state was removed — unreachable by
  construction, since the roster always contains at least the seeded admin
  (flagged at the Phase 6 review as dead code, cleaned up now).

**Production-readiness facts confirmed while scanning** (no changes needed):
the session cookie is already `httponly` + `samesite=lax` with a
`cookie_secure` setting to flip on under HTTPS; `jwt_secret` and seed admin
credentials already come from env vars; the backend needs no CORS config
since production will serve frontend and API from one origin, same as the
dev proxy does.

## Deployment (live since 2026-07-23)

**URL:** https://ludo.bunnycodec.com (CNAME at Namecheap →
codec-ludo.onrender.com, which also still works; Render-managed TLS cert —
issuance needed one retry because it raced DNS propagation). **Hosting:** one Render free-tier Web Service (workspace on the
user's GitHub-linked account), region Singapore — chosen because most players
are in India (the admin is in the UK); the database sits in the same region
since app↔DB latency matters more than user↔app. **Database:** Neon free-tier
Postgres, project `codec-ludo`, also Singapore. **Deploys:** automatic on
every push to `main` — the repo on GitHub is the source of truth; Render
clones and builds it, and a failed build keeps the previous version live.

Render service settings, as configured:
- Language **Python 3**, branch `main`, root directory empty
- Build: `npm --prefix frontend install && npm --prefix frontend run build && pip install ./backend`
- Start: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Env vars: `DATABASE_URL` (Neon connection string), `JWT_SECRET`
  (Render-generated), `COOKIE_SECURE=true`, `ADMIN_USERNAME`,
  `ADMIN_TEMP_PASSWORD` (seed admin — password rotated at first login)

How one service serves everything: the build compiles the React app to
`frontend/dist`; `main.py` serves those static files and answers page
navigations (Accept: text/html) with the SPA's index.html — see the
"Production" block in `main.py`. Same-origin means the auth cookie works
exactly as through the dev proxy; no CORS anywhere. `db.py` rewrites
`postgresql://` URLs to `postgresql+psycopg://` so Neon's string pastes
as-is.

Known free-tier behaviors: the service would sleep after ~15 min idle
(~30-50s cold start), but a free UptimeRobot monitor pings
`https://ludo.bunnycodec.com/health` every 10 minutes to keep it awake —
this fits because the free 750 instance-hours/month cover one service
running 24/7, and it doubles as real downtime alerting to the user's email.
A $0 build-minutes spend limit is set so overage pauses builds instead of
charging. **Gotchas for future changes:** any schema change to an existing
table needs a manual `ALTER TABLE` against the production Neon DB at deploy
time (still no migration tool — Alembic is the agreed first post-launch
improvement), and Neon's free tier keeps only a short restore window, so an
occasional `pg_dump` export is the cheap backup insurance.

## How to use this file

Each time a build phase from Section 15 of the spec lands, this file should gain a
short section describing what was built, which files matter, and any new concepts
introduced — so opening this file always gives an accurate, current picture of the
whole system without reading the code line by line.
