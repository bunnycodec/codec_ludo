"""Request/response shapes for the API (Pydantic models).

These define exactly what JSON each endpoint accepts and returns — and FastAPI
rejects anything that doesn't match, before our code even runs. Note UserOut
deliberately excludes password_hash and current_session_token: secrets never leave
the server.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from .models import Color, GameStatus, InviteStatus, Role


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_]+$")
    temp_password: str = Field(min_length=8)


class ResetPasswordRequest(BaseModel):
    temp_password: str = Field(min_length=8)


class UserOut(BaseModel):
    id: int
    username: str
    role: Role
    must_change_password: bool
    created_at: datetime


class UserStatsOut(BaseModel):
    """Career totals (spec Section 11), confirmed games only. Kept separate
    from UserOut — which is embedded all over the place (invites, family
    roster, etc.) — so stats don't leak into contexts that don't need them."""

    total_points: int
    games_played: int
    wins: int
    # None (not 0) when games_played is 0 — "no games yet" isn't the same as
    # "a confirmed 0% win rate," and the frontend already shows "—" for this.
    win_percentage: float | None
    tokens_cut: int
    sixes_rolled: int


class LoginResponse(BaseModel):
    user: UserOut
    # Signals the frontend to route straight to the change-password screen.
    must_change_password: bool


class CreateGameRequest(BaseModel):
    # The creator's own id may or may not be in here — including it auto-accepts
    # them into the game; leaving it out makes them an organizer who isn't playing.
    player_ids: list[int] = Field(min_length=2, max_length=4)


class ReplaceInviteRequest(BaseModel):
    new_user_id: int


class GameInviteOut(BaseModel):
    id: int
    user: UserOut
    status: InviteStatus
    responded_at: datetime | None


class GameOut(BaseModel):
    id: int
    creator: UserOut
    status: GameStatus
    created_at: datetime
    started_at: datetime | None
    invites: list[GameInviteOut]


class TokenOut(BaseModel):
    id: int
    user_id: int
    color: Color
    index: int
    position: int


class BoardPlayerOut(BaseModel):
    user: UserOut
    color: Color
    rank: int | None
    finished_at: datetime | None
    sixes_rolled: int
    tokens_cut: int


class BoardOut(BaseModel):
    id: int
    creator_id: int
    status: GameStatus
    current_turn_user_id: int | None
    dice_value: int | None
    last_roll_value: int | None
    roll_sequence: int
    consecutive_sixes: int
    players: list[BoardPlayerOut]
    tokens: list[TokenOut]
    # Legal moves for the requesting user right now — empty unless it's their
    # turn and they have a roll pending. Saves the frontend from reimplementing
    # the rules just to know which tokens are clickable.
    my_movable_token_ids: list[int]
    # None while a completed game still sits in the admin's queue; set once
    # they Confirm it. Lets the Final Standings screen say something more
    # accurate than "waiting on the admin" forever.
    confirmed_at: datetime | None


class MoveRequest(BaseModel):
    token_id: int


class PendingConfirmationPlayerOut(BaseModel):
    user: UserOut
    color: Color
    rank: int
    sixes_rolled: int
    tokens_cut: int
    points_if_confirmed: int


class PendingConfirmationOut(BaseModel):
    id: int
    started_at: datetime | None
    players: list[PendingConfirmationPlayerOut]  # sorted by rank


class MyPendingConfirmationOut(BaseModel):
    id: int
    started_at: datetime | None
    color: Color
    rank: int
    points_if_confirmed: int
