"""Game creation & invite flow: create a game, invite 2-4 players, accept/decline,
replace a declined invitee, and start once at least 2 have accepted.

The board/dice/moves themselves don't exist yet — a started game just flips to
`active` with no further behavior. That's Phase 4.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from .. import ludo
from ..deps import AdminUser, CurrentUser, DbSession
from ..models import Game, GameInvite, GameStatus, InviteStatus, Token, User
from ..schemas import (
    CreateGameRequest,
    GameInviteOut,
    GameOut,
    MyPendingConfirmationOut,
    PendingConfirmationOut,
    PendingConfirmationPlayerOut,
    ReplaceInviteRequest,
    UserOut,
)
from ..sockets import notify_board_changed

router = APIRouter(prefix="/games", tags=["games"])


def _to_user_out(user: User) -> UserOut:
    return UserOut.model_validate(user, from_attributes=True)


def _to_game_out(session: DbSession, game: Game) -> GameOut:
    creator = session.get(User, game.creator_id)
    invites = session.exec(select(GameInvite).where(GameInvite.game_id == game.id)).all()
    invite_outs = []
    for invite in invites:
        invitee = session.get(User, invite.user_id)
        invite_outs.append(
            GameInviteOut(
                id=invite.id,
                user=_to_user_out(invitee),
                status=invite.status,
                responded_at=invite.responded_at,
            )
        )
    return GameOut(
        id=game.id,
        creator=_to_user_out(creator),
        status=game.status,
        created_at=game.created_at,
        started_at=game.started_at,
        invites=invite_outs,
    )


def _get_game_or_404(session: DbSession, game_id: int) -> Game:
    game = session.get(Game, game_id)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such game.")
    return game


@router.post("", response_model=GameOut, status_code=status.HTTP_201_CREATED)
def create_game(body: CreateGameRequest, user: CurrentUser, session: DbSession):
    # One draft at a time keeps the "resume my in-progress game" UI simple — a
    # creator finishes or starts what they've got before opening another.
    existing_draft = session.exec(
        select(Game).where(Game.creator_id == user.id, Game.status == GameStatus.pending)
    ).first()
    if existing_draft is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "You already have a game waiting for players. Finish or start that one first.",
        )

    player_ids = set(body.player_ids)
    if len(player_ids) != len(body.player_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Duplicate players selected.")

    found = session.exec(select(User).where(User.id.in_(player_ids))).all()
    if len(found) != len(player_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "One or more selected players don't exist.")

    game = Game(creator_id=user.id)
    session.add(game)
    session.flush()  # assigns game.id without ending the transaction

    now = datetime.now(timezone.utc)
    for player_id in player_ids:
        # The creator including themselves in the roster is an auto-accept, not a
        # real invite — they obviously want to play if they picked themselves.
        is_creator = player_id == user.id
        session.add(
            GameInvite(
                game_id=game.id,
                user_id=player_id,
                status=InviteStatus.accepted if is_creator else InviteStatus.pending,
                responded_at=now if is_creator else None,
            )
        )

    session.commit()
    session.refresh(game)
    return _to_game_out(session, game)


@router.get("/pending-invites", response_model=list[GameOut])
def my_pending_invites(user: CurrentUser, session: DbSession):
    """Games this user has been invited to and hasn't responded to yet."""
    invites = session.exec(
        select(GameInvite).where(
            GameInvite.user_id == user.id, GameInvite.status == InviteStatus.pending
        )
    ).all()
    games = [session.get(Game, invite.game_id) for invite in invites]
    return [_to_game_out(session, game) for game in games]


@router.get("/pending-created", response_model=list[GameOut])
def my_pending_created_games(user: CurrentUser, session: DbSession):
    """Games this user created that are still collecting invite responses."""
    games = session.exec(
        select(Game).where(Game.creator_id == user.id, Game.status == GameStatus.pending)
    ).all()
    return [_to_game_out(session, game) for game in games]


@router.get("/waiting-to-start", response_model=list[GameOut])
def my_accepted_pending_games(user: CurrentUser, session: DbSession):
    """Games this user accepted an invite to, that the creator hasn't started yet.

    Excludes games this user created themselves — those surface via
    /pending-created instead, since the creator sees the full waiting room
    (with Replace/End room), not just a status line.
    """
    invites = session.exec(
        select(GameInvite).where(
            GameInvite.user_id == user.id, GameInvite.status == InviteStatus.accepted
        )
    ).all()
    games = []
    for invite in invites:
        game = session.get(Game, invite.game_id)
        if game.status == GameStatus.pending and game.creator_id != user.id:
            games.append(game)
    return [_to_game_out(session, game) for game in games]


@router.get("/active-for-me", response_model=list[GameOut])
def my_active_games(user: CurrentUser, session: DbSession):
    """Games in progress that this user is part of — as creator or as an
    accepted player. Feeds the Dashboard's "Enter Room" button so it can route
    into a live game, not just a pre-start draft."""
    my_invites = session.exec(
        select(GameInvite).where(
            GameInvite.user_id == user.id, GameInvite.status == InviteStatus.accepted
        )
    ).all()
    game_ids = {invite.game_id for invite in my_invites}
    created = session.exec(
        select(Game).where(Game.creator_id == user.id, Game.status == GameStatus.active)
    ).all()
    game_ids |= {g.id for g in created}

    games = []
    for game_id in game_ids:
        game = session.get(Game, game_id)
        if game.status == GameStatus.active:
            games.append(game)
    return [_to_game_out(session, game) for game in games]


@router.get("/pending-confirmation", response_model=list[PendingConfirmationOut])
def pending_confirmation_games(admin: AdminUser, session: DbSession):
    """Every completed game still awaiting the admin's Confirm/Reject (spec
    Section 9) — feeds the Dashboard's "Pending Confirmations" card. Must be
    registered before the bare `/{game_id}` route below, or FastAPI would try
    (and fail) to parse "pending-confirmation" as a game id."""
    games = session.exec(
        select(Game).where(Game.status == GameStatus.completed, Game.confirmed_at.is_(None))
    ).all()

    out = []
    for game in games:
        invites = session.exec(
            select(GameInvite).where(
                GameInvite.game_id == game.id,
                GameInvite.status == InviteStatus.accepted,
                GameInvite.rank.is_not(None),
            )
        ).all()
        invites.sort(key=lambda i: i.rank)
        player_count = len(invites)
        players = [
            PendingConfirmationPlayerOut(
                user=_to_user_out(session.get(User, invite.user_id)),
                color=invite.color,
                rank=invite.rank,
                sixes_rolled=invite.sixes_rolled,
                tokens_cut=invite.tokens_cut,
                points_if_confirmed=ludo.points_for_rank(player_count, invite.rank),
            )
            for invite in invites
        ]
        out.append(PendingConfirmationOut(id=game.id, started_at=game.started_at, players=players))
    return out


@router.get("/my-pending-confirmation", response_model=list[MyPendingConfirmationOut])
def my_pending_confirmation_games(user: CurrentUser, session: DbSession):
    """This user's own results in completed-but-unconfirmed games — spec
    Section 9: "participants can see their own result... tagged pending
    confirmation" until the admin acts on it. Same route-ordering note as
    pending_confirmation_games above."""
    my_invites = session.exec(
        select(GameInvite).where(
            GameInvite.user_id == user.id,
            GameInvite.status == InviteStatus.accepted,
            GameInvite.rank.is_not(None),
        )
    ).all()

    out = []
    for invite in my_invites:
        game = session.get(Game, invite.game_id)
        if game.status != GameStatus.completed or game.confirmed_at is not None:
            continue
        player_count = len(
            session.exec(
                select(GameInvite).where(
                    GameInvite.game_id == game.id, GameInvite.status == InviteStatus.accepted
                )
            ).all()
        )
        out.append(
            MyPendingConfirmationOut(
                id=game.id,
                started_at=game.started_at,
                color=invite.color,
                rank=invite.rank,
                points_if_confirmed=ludo.points_for_rank(player_count, invite.rank),
            )
        )
    return out


@router.delete("/{game_id}", status_code=status.HTTP_204_NO_CONTENT)
def end_room(game_id: int, user: CurrentUser, session: DbSession):
    """Creator abandons a draft that hasn't started yet — hard-deleted, since a
    game that never started has nothing worth keeping for audit purposes. Every
    invitee's copy (accepted or still pending) disappears with it."""
    game = _get_game_or_404(session, game_id)
    if game.creator_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator can end this room.")
    if game.status != GameStatus.pending:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only a game that hasn't started can be ended this way."
        )

    invites = session.exec(select(GameInvite).where(GameInvite.game_id == game_id)).all()
    for invite in invites:
        session.delete(invite)
    session.delete(game)
    session.commit()


@router.get("/{game_id}", response_model=GameOut)
def get_game(game_id: int, user: CurrentUser, session: DbSession):
    game = _get_game_or_404(session, game_id)
    invites = session.exec(select(GameInvite).where(GameInvite.game_id == game_id)).all()
    is_participant = game.creator_id == user.id or any(i.user_id == user.id for i in invites)
    if not is_participant:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You're not part of this game.")
    return _to_game_out(session, game)


def _get_own_pending_invite(
    session: DbSession, game_id: int, invite_id: int, user: User
) -> GameInvite:
    invite = session.get(GameInvite, invite_id)
    if invite is None or invite.game_id != game_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such invite.")
    if invite.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This invite isn't yours.")
    if invite.status != InviteStatus.pending:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You've already responded to this invite.")
    return invite


@router.post("/{game_id}/invites/{invite_id}/accept", response_model=GameOut)
def accept_invite(game_id: int, invite_id: int, user: CurrentUser, session: DbSession):
    invite = _get_own_pending_invite(session, game_id, invite_id, user)
    invite.status = InviteStatus.accepted
    invite.responded_at = datetime.now(timezone.utc)
    session.add(invite)
    session.commit()
    return _to_game_out(session, _get_game_or_404(session, game_id))


@router.post("/{game_id}/invites/{invite_id}/decline", response_model=GameOut)
def decline_invite(game_id: int, invite_id: int, user: CurrentUser, session: DbSession):
    invite = _get_own_pending_invite(session, game_id, invite_id, user)
    invite.status = InviteStatus.declined
    invite.responded_at = datetime.now(timezone.utc)
    session.add(invite)
    session.commit()
    return _to_game_out(session, _get_game_or_404(session, game_id))


@router.post("/{game_id}/invites/{invite_id}/replace", response_model=GameOut)
def replace_invite(
    game_id: int, invite_id: int, body: ReplaceInviteRequest, user: CurrentUser, session: DbSession
):
    game = _get_game_or_404(session, game_id)
    if game.creator_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator can replace a player.")
    if game.status != GameStatus.pending:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This game has already started.")

    invite = session.get(GameInvite, invite_id)
    if invite is None or invite.game_id != game_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such invite.")
    if invite.status != InviteStatus.declined:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only a declined invite can be replaced.")

    new_user = session.get(User, body.new_user_id)
    if new_user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No such player.")

    other_invites = session.exec(
        select(GameInvite).where(GameInvite.game_id == game_id, GameInvite.id != invite_id)
    ).all()
    if any(i.user_id == body.new_user_id for i in other_invites):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That player is already in this game.")

    invite.user_id = body.new_user_id
    invite.status = InviteStatus.pending
    invite.responded_at = None
    session.add(invite)
    session.commit()
    return _to_game_out(session, game)


@router.post("/{game_id}/start", response_model=GameOut)
def start_game(game_id: int, user: CurrentUser, session: DbSession):
    game = _get_game_or_404(session, game_id)
    if game.creator_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator can start this game.")
    if game.status != GameStatus.pending:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This game has already started.")

    invites = session.exec(select(GameInvite).where(GameInvite.game_id == game_id)).all()
    accepted_count = sum(1 for i in invites if i.status == InviteStatus.accepted)
    if accepted_count < 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "At least 2 players must accept before you can start."
        )

    # Whoever hasn't responded yet is out — starting the game closes the invite window.
    accepted = []
    for invite in invites:
        if invite.status == InviteStatus.pending:
            invite.status = InviteStatus.cancelled
            session.add(invite)
        elif invite.status == InviteStatus.accepted:
            accepted.append(invite)

    # Random color assignment, not tied to any player's profile or preference
    # (spec Section 6), and 4 fresh tokens per player, all starting in the yard.
    colors = ludo.assign_colors([invite.user_id for invite in accepted])
    for invite in accepted:
        invite.color = colors[invite.user_id]
        session.add(invite)
        for index in range(4):
            session.add(
                Token(game_id=game.id, user_id=invite.user_id, color=invite.color, index=index)
            )

    turn_order = sorted(accepted, key=lambda i: ludo.COLOR_ORDER.index(i.color))
    game.status = GameStatus.active
    game.started_at = datetime.now(timezone.utc)
    game.current_turn_user_id = turn_order[0].user_id
    session.add(game)
    session.commit()
    return _to_game_out(session, game)


@router.post("/{game_id}/cancel", response_model=GameOut)
async def cancel_game(game_id: int, user: CurrentUser, session: DbSession):
    """Creator-only mid-game cancel (spec Section 7). The game and its
    per-player logged stats stay in the DB for audit visibility, but a
    cancelled game is fully excluded from all leaderboard stats — there's no
    admin Confirm/Reject step for it, unlike a completed game."""
    game = _get_game_or_404(session, game_id)
    if game.creator_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator can quit this game.")
    if game.status != GameStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This game isn't in progress.")

    game.status = GameStatus.cancelled
    game.current_turn_user_id = None
    game.dice_value = None
    session.add(game)
    session.commit()
    await notify_board_changed(game_id)
    return _to_game_out(session, game)


@router.post("/{game_id}/confirm", response_model=GameOut)
def confirm_game(game_id: int, admin: AdminUser, session: DbSession):
    """Adds this game's points/tokens-cut/sixes-rolled to every participant's
    career totals (spec Sections 9 & 11). The game record itself stays —
    only marked confirmed — unlike reject, which hard-deletes it."""
    game = _get_game_or_404(session, game_id)
    if game.status != GameStatus.completed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only a completed game can be confirmed.")
    if game.confirmed_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This game was already confirmed.")

    invites = session.exec(
        select(GameInvite).where(
            GameInvite.game_id == game_id, GameInvite.status == InviteStatus.accepted
        )
    ).all()
    player_count = len(invites)
    for invite in invites:
        player = session.get(User, invite.user_id)
        player.total_points += ludo.points_for_rank(player_count, invite.rank)
        player.games_played += 1
        if invite.rank == 1:
            player.wins += 1
        player.tokens_cut += invite.tokens_cut
        player.sixes_rolled += invite.sixes_rolled
        session.add(player)

    game.confirmed_at = datetime.now(timezone.utc)
    session.add(game)
    session.commit()
    return _to_game_out(session, game)


@router.post("/{game_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
def reject_game(game_id: int, admin: AdminUser, session: DbSession):
    """Hard-deletes a completed game — no audit trace, no stats change, and it
    disappears from every participant's view too (spec Section 9)."""
    game = _get_game_or_404(session, game_id)
    if game.status != GameStatus.completed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only a completed game can be rejected.")
    if game.confirmed_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This game was already confirmed.")

    for token in session.exec(select(Token).where(Token.game_id == game_id)).all():
        session.delete(token)
    for invite in session.exec(select(GameInvite).where(GameInvite.game_id == game_id)).all():
        session.delete(invite)
    session.delete(game)
    session.commit()
