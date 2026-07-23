"""DEV-ONLY testing shortcuts — never active in production, by two
independent locks:

1. This router is only registered when the DEBUG_TOOLS env var is true
   (see main.py); it's set in the local .env and never on Render, so in
   production these URLs don't exist (404).
2. The frontend controls that call them only render in Vite dev mode
   (import.meta.env.DEV — always false in a production build).

Two admin-only shortcuts for manual testing: forcing the next dice roll to
a specific value, and instantly completing an active game so the Game Over
/ Final Standings screen can be previewed without playing a full game out.
Both surfaced as small controls on the live board page (admin only, dev
server only).
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, status
from sqlmodel import select

from .. import ludo
from ..deps import AdminUser, DbSession
from ..models import Game, GameInvite, GameStatus, InviteStatus, Token
from ..sockets import notify_board_changed

router = APIRouter(prefix="/debug", tags=["debug"])


@router.post("/force-dice/{value}")
def force_dice(value: Annotated[int, Path(ge=1, le=6)], admin: AdminUser):
    ludo.force_next_roll(value)
    return {"forced_next_roll": value}


@router.post("/games/{game_id}/finish-now")
async def finish_game_now(game_id: int, admin: AdminUser, session: DbSession):
    """Jumps every accepted player's tokens straight to their finish square
    and marks the game completed, purely so the end-of-game UI can be seen
    on demand. Ranks are assigned in whatever order the invites already sat
    in — arbitrary, no gameplay meaning, not a real playthrough result."""
    game = session.get(Game, game_id)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such game.")
    if game.status != GameStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This game isn't in progress.")

    invites = session.exec(
        select(GameInvite).where(
            GameInvite.game_id == game_id, GameInvite.status == InviteStatus.accepted
        )
    ).all()
    now = datetime.now(timezone.utc)
    for i, invite in enumerate(invites):
        if invite.finished_at is None:
            invite.finished_at = now
            invite.rank = i + 1
            session.add(invite)

    tokens = session.exec(select(Token).where(Token.game_id == game_id)).all()
    for token in tokens:
        token.position = ludo.FINISH_POSITION
        session.add(token)

    game.status = GameStatus.completed
    game.current_turn_user_id = None
    game.dice_value = None
    session.add(game)
    session.commit()
    await notify_board_changed(game_id)
    return {"status": "completed"}
