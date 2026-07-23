"""Read-only family roster, for picking players when creating a game.

Distinct from /admin/users: any logged-in player can see who else is in the
family (they need this to invite people), but only an admin can create/reset/
delete accounts.
"""

from fastapi import APIRouter
from sqlmodel import select

from ..deps import CurrentUser, DbSession
from ..models import User
from ..schemas import UserOut, UserStatsOut

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_family(user: CurrentUser, session: DbSession):
    users = session.exec(select(User).order_by(User.username)).all()
    return [UserOut.model_validate(u, from_attributes=True) for u in users]


@router.get("/me/stats", response_model=UserStatsOut)
def my_stats(user: CurrentUser):
    """Career totals (spec Section 11), confirmed games only — feeds the
    Dashboard's "Your Stats" card. Kept off UserOut itself since that shape is
    embedded all over the place (invites, family roster) that doesn't need it."""
    win_percentage = (user.wins / user.games_played * 100) if user.games_played else None
    return UserStatsOut(
        total_points=user.total_points,
        games_played=user.games_played,
        wins=user.wins,
        win_percentage=win_percentage,
        tokens_cut=user.tokens_cut,
        sixes_rolled=user.sixes_rolled,
    )
