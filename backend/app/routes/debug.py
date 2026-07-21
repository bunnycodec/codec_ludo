"""TESTING ONLY — not part of the spec. Lets an admin force the next dice roll
to a specific value, for manual testing (reaching a specific capture, the
3-sixes forfeit, etc. on demand instead of waiting on real randomness).
Surfaced as a small number-button row on the live board page (admin only).

Full removable set — every place this feature touches, all marked "TESTING
ONLY" in comments, delete all to remove the feature completely:
  - backend/app/routes/debug.py (this file)
  - the two wiring lines in backend/app/main.py
  - the forced-roll block in backend/app/ludo.py
  - frontend/vite.config.js — the `/debug` proxy line
  - frontend/src/api.js — the `forceDice` export
  - frontend/src/pages/GamePage.jsx — the `forcedNotice` state, the
    `handleForceDice` function, and the button row that calls it
Nothing else in the app references any of this.
"""

from typing import Annotated

from fastapi import APIRouter, Path

from .. import ludo
from ..deps import AdminUser

router = APIRouter(prefix="/debug", tags=["debug"])


@router.post("/force-dice/{value}")
def force_dice(value: Annotated[int, Path(ge=1, le=6)], admin: AdminUser):
    ludo.force_next_roll(value)
    return {"forced_next_roll": value}
