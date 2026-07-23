"""The global Leaderboard page (spec Section 12) — every registered player's
career stats, ranked by Total Points. Read-only; the underlying numbers are
only ever written by routes/games.py's confirm_game.
"""

from fastapi import APIRouter
from sqlmodel import select

from ..deps import CurrentUser, DbSession
from ..models import User
from ..schemas import LeaderboardEntryOut

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("", response_model=list[LeaderboardEntryOut])
def get_leaderboard(user: CurrentUser, session: DbSession):
    users = session.exec(
        select(User).order_by(User.total_points.desc(), User.username)
    ).all()

    entries = []
    rank = 0
    last_points = None
    for i, u in enumerate(users):
        # Standard competition ranking: ties share a rank; the next distinct
        # score skips accordingly (1, 1, 3) rather than every row incrementing.
        if u.total_points != last_points:
            rank = i + 1
            last_points = u.total_points
        win_percentage = (u.wins / u.games_played * 100) if u.games_played else None
        entries.append(
            LeaderboardEntryOut(
                id=u.id,
                username=u.username,
                rank=rank,
                total_points=u.total_points,
                games_played=u.games_played,
                wins=u.wins,
                win_percentage=win_percentage,
                tokens_cut=u.tokens_cut,
                sixes_rolled=u.sixes_rolled,
            )
        )
    return entries
