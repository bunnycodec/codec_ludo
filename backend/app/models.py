"""Database tables, defined as SQLModel classes.

Each class with `table=True` becomes a real table in the database; each attribute
becomes a column. This is the single source of truth for what a record contains.
"""

from datetime import datetime, timezone
from enum import Enum

from sqlmodel import Field, SQLModel


class Role(str, Enum):
    admin = "admin"
    player = "player"


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str
    role: Role = Role.player

    # True for freshly created / admin-reset accounts: the user must set their own
    # password before doing anything else.
    must_change_password: bool = True

    # Random token regenerated on every login. The JWT carries a copy; if the copy
    # no longer matches this column, that JWT belongs to an older session (the user
    # logged in somewhere else since) and is rejected. This is the whole
    # one-active-session-per-account mechanism.
    current_session_token: str | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Career totals (spec Section 11) — only ever incremented at the moment
    # the admin confirms a completed game (see routes/games.py's confirm_game).
    # Win % is deliberately not stored here; it's derived from wins/games_played
    # wherever it's displayed, so there's never a stale/out-of-sync percentage.
    total_points: int = 0
    games_played: int = 0
    wins: int = 0
    tokens_cut: int = 0
    sixes_rolled: int = 0


class GameStatus(str, Enum):
    # Still collecting invite responses — not enough accepts to start yet.
    pending = "pending"
    # Started: the board is live, players are taking turns.
    active = "active"
    # Every player has finished and been ranked. Sits here awaiting admin
    # Confirm/Reject (see Game.confirmed_at below).
    completed = "completed"
    # The creator ended it mid-play (spec Section 7). Kept for audit
    # visibility but fully excluded from all leaderboard stats.
    cancelled = "cancelled"


class InviteStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    declined = "declined"
    # Set on every still-pending invite the moment the creator starts the game.
    cancelled = "cancelled"


class Color(str, Enum):
    red = "red"
    green = "green"
    yellow = "yellow"
    blue = "blue"


class Game(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    creator_id: int = Field(foreign_key="user.id")
    status: GameStatus = GameStatus.pending
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None

    # Whose turn it is right now. None once the game is completed (or before it
    # starts). The server is the sole authority on turn order — see app/ludo.py.
    current_turn_user_id: int | None = None
    # The value from the current player's last roll, still awaiting a move. None
    # means "no roll pending" — either they haven't rolled yet this turn, or their
    # last roll's move has already been applied. Drives whether a move is legal
    # right now; NOT what the frontend should display on the die face (see
    # last_roll_value below) — a roll that immediately auto-passes the turn
    # (no legal move for it) clears this in the very same request that reported
    # it, so the value would never be visible to display from this field alone.
    dice_value: int | None = None
    # What the die should visually show — the most recent value actually rolled,
    # independent of whether that roll is still "pending" or already resolved.
    # Only ever changes when a fresh roll happens (see roll_sequence).
    last_roll_value: int | None = None
    # Increments on every roll, regardless of the value. The frontend watches
    # this (not last_roll_value) to detect "a new roll just happened" — relying
    # on the value alone would miss the animation whenever the same number
    # comes up twice in a row across different players' turns.
    roll_sequence: int = 0
    # How many 6s the current player has rolled in a row this turn-sequence. A
    # third in a row forfeits the turn instead of granting another roll. Resets
    # to 0 whenever the turn passes to someone else.
    consecutive_sixes: int = 0
    # Set the moment the admin confirms a completed game — distinguishes
    # "completed, still in the admin's queue" (None) from "completed, already
    # reviewed" (a timestamp). A *rejected* game is hard-deleted instead of
    # ever reaching this field (spec Section 9).
    confirmed_at: datetime | None = None


class GameInvite(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    game_id: int = Field(foreign_key="game.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    status: InviteStatus = InviteStatus.pending
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    responded_at: datetime | None = None

    # The following are only meaningful once the game is active — set at start
    # time (color) or as the game is played (the rest). Logged per-game as it
    # happens per spec Section 11; Phase 5 sums these into career totals only
    # when the admin confirms the game.
    color: Color | None = None
    finished_at: datetime | None = None
    # 1st, 2nd, 3rd, 4th — assigned the moment this player's 4th token reaches home.
    rank: int | None = None
    sixes_rolled: int = 0
    tokens_cut: int = 0


class Token(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    game_id: int = Field(foreign_key="game.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    color: Color
    # Which of this player's 4 tokens (0-3) — cosmetic/identification only.
    index: int

    # -1 = still in the home yard, hasn't left yet.
    # 0-50 = on the shared 51-square outer track (see app/ludo.py for the
    #   per-color offset that maps this to a global board square).
    # 51-56 = in this color's private 6-square home column (not shared, no
    #   captures happen here).
    # 56 = reached home / finished (56 doubles as "home column, last square").
    position: int = -1
