"""The live board: fetching state, rolling dice, moving tokens.

Actions arrive as plain REST calls (not socket events) — much simpler to test
and reason about. After a REST call changes anything, the route broadcasts a
"something changed" ping over the socket (see app/sockets.py) so every other
client at the table refetches the board immediately instead of waiting for a
manual refresh. This is the one place in the app that pushes live, on purpose —
see CLAUDE.md's Phase 4 notes for why invites don't work this way but this does.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from .. import ludo
from ..deps import CurrentUser, DbSession
from ..models import Game, GameInvite, GameStatus, InviteStatus, Token, User
from ..schemas import BoardOut, BoardPlayerOut, MoveRequest, TokenOut, UserOut
from ..sockets import notify_board_changed

router = APIRouter(prefix="/games", tags=["gameplay"])


def _get_active_game(session: DbSession, game_id: int) -> Game:
    game = session.get(Game, game_id)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such game.")
    if game.status not in (GameStatus.active, GameStatus.completed, GameStatus.cancelled):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This game hasn't started yet.")
    return game


def _require_participant(session: DbSession, game: Game, user: User) -> None:
    is_participant = game.creator_id == user.id or session.exec(
        select(GameInvite).where(
            GameInvite.game_id == game.id,
            GameInvite.user_id == user.id,
            GameInvite.status == InviteStatus.accepted,
        )
    ).first()
    if not is_participant:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You're not part of this game.")


def _active_turn_order(session: DbSession, game_id: int) -> list[int]:
    """Accepted players who haven't finished yet, in stable color order."""
    invites = session.exec(
        select(GameInvite).where(
            GameInvite.game_id == game_id, GameInvite.status == InviteStatus.accepted
        )
    ).all()
    still_playing = [i for i in invites if i.finished_at is None]
    still_playing.sort(key=lambda i: ludo.COLOR_ORDER.index(i.color))
    return [i.user_id for i in still_playing]


def _board_out(session: DbSession, game: Game, requesting_user_id: int) -> BoardOut:
    invites = session.exec(
        select(GameInvite).where(
            GameInvite.game_id == game.id, GameInvite.status == InviteStatus.accepted
        )
    ).all()
    players = []
    for invite in invites:
        user = session.get(User, invite.user_id)
        players.append(
            BoardPlayerOut(
                user=UserOut.model_validate(user, from_attributes=True),
                color=invite.color,
                rank=invite.rank,
                finished_at=invite.finished_at,
                sixes_rolled=invite.sixes_rolled,
                tokens_cut=invite.tokens_cut,
            )
        )

    tokens = session.exec(select(Token).where(Token.game_id == game.id)).all()
    token_outs = [
        TokenOut(id=t.id, user_id=t.user_id, color=t.color, index=t.index, position=t.position)
        for t in tokens
    ]

    my_movable = []
    if game.current_turn_user_id == requesting_user_id and game.dice_value is not None:
        my_tokens = [t for t in tokens if t.user_id == requesting_user_id]
        my_movable = ludo.legal_move_token_ids(my_tokens, game.dice_value)

    return BoardOut(
        id=game.id,
        creator_id=game.creator_id,
        status=game.status,
        current_turn_user_id=game.current_turn_user_id,
        dice_value=game.dice_value,
        last_roll_value=game.last_roll_value,
        roll_sequence=game.roll_sequence,
        consecutive_sixes=game.consecutive_sixes,
        players=players,
        tokens=token_outs,
        my_movable_token_ids=my_movable,
    )


def _advance_turn(session: DbSession, game: Game) -> None:
    order = _active_turn_order(session, game.id)
    if not order:
        game.status = GameStatus.completed
        game.current_turn_user_id = None
    else:
        game.current_turn_user_id = ludo.next_active_user_id(order, game.current_turn_user_id)
    game.dice_value = None
    game.consecutive_sixes = 0


@router.get("/{game_id}/board", response_model=BoardOut)
def get_board(game_id: int, user: CurrentUser, session: DbSession):
    game = _get_active_game(session, game_id)
    _require_participant(session, game, user)
    return _board_out(session, game, user.id)


@router.post("/{game_id}/roll", response_model=BoardOut)
async def roll_dice(game_id: int, user: CurrentUser, session: DbSession):
    game = _get_active_game(session, game_id)
    _require_participant(session, game, user)
    if game.status != GameStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This game is no longer active.")
    if game.current_turn_user_id != user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "It's not your turn.")
    if game.dice_value is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You've already rolled — make your move.")

    my_invite = session.exec(
        select(GameInvite).where(GameInvite.game_id == game_id, GameInvite.user_id == user.id)
    ).one()

    value = ludo.roll_dice()
    game.dice_value = value
    # Set once here and never touched by _advance_turn — this is what the
    # frontend displays on the die face, independent of dice_value possibly
    # getting cleared below in the very same request (an auto-passed roll with
    # no legal move). roll_sequence always increments so the frontend can tell
    # "a new roll happened" even when the same face comes up twice in a row.
    game.last_roll_value = value
    game.roll_sequence += 1

    forfeited = False
    if value == 6:
        game.consecutive_sixes += 1
        my_invite.sixes_rolled += 1
        session.add(my_invite)
        if game.consecutive_sixes >= 3:
            forfeited = True

    my_tokens = session.exec(
        select(Token).where(Token.game_id == game_id, Token.user_id == user.id)
    ).all()
    movable = [] if forfeited else ludo.legal_move_token_ids(my_tokens, value)

    if forfeited:
        # Third six in a row: this roll is void, turn passes immediately.
        _advance_turn(session, game)
    elif not movable:
        if value == 6:
            # A 6 always earns another roll, even if this particular roll had
            # nothing to move — clear dice_value so they can roll again.
            game.dice_value = None
        else:
            _advance_turn(session, game)
    # else: leave dice_value set and wait for POST /move.

    session.add(game)
    session.commit()
    await notify_board_changed(game_id)
    return _board_out(session, game, user.id)


@router.post("/{game_id}/move", response_model=BoardOut)
async def move_token(game_id: int, body: MoveRequest, user: CurrentUser, session: DbSession):
    game = _get_active_game(session, game_id)
    _require_participant(session, game, user)
    if game.status != GameStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This game is no longer active.")
    if game.current_turn_user_id != user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "It's not your turn.")
    if game.dice_value is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Roll the dice first.")

    my_invite = session.exec(
        select(GameInvite).where(GameInvite.game_id == game_id, GameInvite.user_id == user.id)
    ).one()
    my_tokens = session.exec(
        select(Token).where(Token.game_id == game_id, Token.user_id == user.id)
    ).all()
    movable = ludo.legal_move_token_ids(my_tokens, game.dice_value)
    if body.token_id not in movable:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That move isn't legal.")

    token = next(t for t in my_tokens if t.id == body.token_id)
    dice_value = game.dice_value

    if token.position == -1:
        token.position = 0
    else:
        token.position += dice_value
    session.add(token)

    # Capture: landing on an unsafe shared-track square sends any opposing
    # tokens there back to their home yard.
    if token.position <= ludo.TRACK_LENGTH - 1 and ludo.is_capturable_square(
        token.color, token.position
    ):
        square = ludo.global_square(token.color, token.position)
        others = session.exec(
            select(Token).where(Token.game_id == game_id, Token.color != token.color)
        ).all()
        for other in others:
            if 0 <= other.position <= ludo.TRACK_LENGTH - 1 and ludo.global_square(
                other.color, other.position
            ) == square:
                other.position = -1
                session.add(other)
                my_invite.tokens_cut += 1

    just_finished_all = False
    if token.position == ludo.FINISH_POSITION:
        remaining = [t for t in my_tokens if t.id != token.id and t.position != ludo.FINISH_POSITION]
        if not remaining:
            # Count who's already finished *before* touching my_invite — autoflush
            # would otherwise write my_invite's own finished_at ahead of this
            # query and double-count it, giving an off-by-one rank.
            already_finished_count = len(
                session.exec(
                    select(GameInvite).where(
                        GameInvite.game_id == game_id, GameInvite.finished_at.is_not(None)
                    )
                ).all()
            )
            my_invite.finished_at = datetime.now(timezone.utc)
            my_invite.rank = already_finished_count + 1
            just_finished_all = True

    session.add(my_invite)

    rolled_six = dice_value == 6
    game.dice_value = None
    if just_finished_all or not rolled_six:
        _advance_turn(session, game)
    # else: same player rolls again (dice_value already cleared above).

    session.commit()
    await notify_board_changed(game_id)
    return _board_out(session, game, user.id)
