"""Classic Ludo rules engine (spec Section 6), kept as plain functions with no
database access — everything here just works on ints/lists so it's easy to reason
about and test in isolation. The routes in routes/gameplay.py do the DB reads/
writes and call into this module for "is this legal" / "what happens now".

Board coordinate scheme, per token:
  -1        = home yard, not yet on the board
  0-50      = on the shared 51-square outer track. A color-relative step number;
              GLOBAL_SQUARE() below converts it to one of the 52 squares on the
              physical board, using each color's own entry point.
  51-56     = in this color's private home column (6 squares, never shared,
              never captured). 56 is the final square — reaching it finishes
              the token.
"""

import random
from enum import Enum


class Color(str, Enum):
    red = "red"
    green = "green"
    yellow = "yellow"
    blue = "blue"


COLOR_ORDER = [Color.red, Color.green, Color.yellow, Color.blue]

# The 52-square outer track is divided into 4 equal 13-square arms; each color
# enters the track at the start of its own arm.
_SQUARES_PER_ARM = 13
ENTRY_SQUARE = {color: i * _SQUARES_PER_ARM for i, color in enumerate(COLOR_ORDER)}

TRACK_LENGTH = 51  # steps 0-50 are on the shared track
HOME_COLUMN_START = 51  # steps 51-56 are in the private home column
FINISH_POSITION = 56

# 8 safe squares total: each color's entry square, plus one "star" square 8
# steps into each color's arm (spec Section 6).
STAR_STEP = 8
SAFE_SQUARES = {ENTRY_SQUARE[c] for c in COLOR_ORDER} | {
    (ENTRY_SQUARE[c] + STAR_STEP) % 52 for c in COLOR_ORDER
}


def global_square(color: Color, position: int) -> int:
    """Where a token at this color-relative track position sits on the shared
    52-square board. Only meaningful for 0 <= position <= 50."""
    return (ENTRY_SQUARE[color] + position) % 52


def is_capturable_square(color: Color, position: int) -> bool:
    """True if a token sitting here can be sent home by an opponent landing on
    it — i.e. it's on the shared track and not one of the 8 safe squares."""
    if not (0 <= position <= TRACK_LENGTH - 1):
        return False
    return global_square(color, position) not in SAFE_SQUARES


def legal_move_token_ids(tokens: list, dice_value: int) -> list[int]:
    """Given one player's 4 tokens and a rolled value, which token ids can
    legally move? `tokens` is any objects with `.id` and `.position`."""
    movable = []
    for token in tokens:
        if token.position == -1:
            if dice_value == 6:
                movable.append(token.id)
        elif token.position < FINISH_POSITION:
            if token.position + dice_value <= FINISH_POSITION:
                movable.append(token.id)
        # position == FINISH_POSITION: already home, never movable again.
    return movable


# --- TESTING ONLY: forced-dice hook -----------------------------------------
# Lets an admin force the *next* roll to a specific value, for manual testing.
# Not part of the spec. See routes/debug.py's docstring for the full list of
# every file this feature touches and what to delete to remove it entirely.
_forced_next_roll: int | None = None


def force_next_roll(value: int) -> None:
    global _forced_next_roll
    _forced_next_roll = value


# --- end testing-only block --------------------------------------------------


def roll_dice() -> int:
    global _forced_next_roll
    if _forced_next_roll is not None:
        value = _forced_next_roll
        _forced_next_roll = None
        return value
    return random.randint(1, 6)


def next_active_user_id(order: list[int], current_user_id: int | None) -> int | None:
    """`order` is the turn order (user ids of players not yet finished), already
    sorted. Returns whoever goes after `current_user_id`, wrapping around; the
    first player in `order` if the current one isn't in it (e.g. game just
    started); or None if nobody's left to play (order is empty — game over)."""
    if not order:
        return None
    if current_user_id not in order:
        return order[0]
    idx = order.index(current_user_id)
    return order[(idx + 1) % len(order)]


def assign_colors(user_ids: list[int]) -> dict[int, Color]:
    """Random color assignment at game start (spec Section 6) — not tied to any
    player preference or profile."""
    colors = COLOR_ORDER.copy()
    random.shuffle(colors)
    return dict(zip(user_ids, colors))
