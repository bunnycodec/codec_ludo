/* The live Ludo board (spec Section 6). State loads once on mount, then stays
 * current via a Socket.io push (see src/socket.js) — this is the one page in
 * the app that updates live instead of on manual refresh, since dice rolls and
 * moves need to appear instantly for everyone at the table.
 *
 * The server is the sole authority on everything: legality, captures, turn
 * order. This component only ever displays `board` as returned by the API and
 * asks the server to roll/move — it never computes game rules itself.
 *
 * Two things here are more involved than they look, both by design:
 *
 * 1. The dice is a genuine 6-face 3D cube (`transform-style: preserve-3d`,
 *    each face placed with `translateZ`), not a flat card faking a spin — a
 *    flat rotateX/rotateY on a single face looked "weird 2D" in practice.
 *    Rolling just rotates the cube to whichever absolute angle brings the
 *    rolled face to the front; the browser's own transform interpolation
 *    does the "tumbling through several faces" look for free.
 *
 * 2. A token's move animates step-by-step along its *actual* board path
 *    (see buildMovePath below) rather than tweening a straight line between
 *    its old and new percentage position — a straight-line tween cuts
 *    diagonally across the board, which reads as wrong the moment the path
 *    bends around a corner. A capture reverses that same path back to the
 *    yard, faster than a normal move.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'
import {
  buildCellGrid,
  CENTER_PINWHEEL_ORDER,
  COLOR_HEX,
  COLORS,
  tokenPercent,
  trackPercent,
  yardCardRect,
  yardSlotPercent,
} from '../boardLayout'
import { Button, Card, ConfirmBar, ErrorNote } from '../components'
import { watchGame } from '../socket'

const CELL_GRID = buildCellGrid() // static board geometry, computed once
const PINWHEEL_GRADIENT = `conic-gradient(from -45deg, ${CENTER_PINWHEEL_ORDER.map(
  (c, i) => `${COLOR_HEX[c]} ${i * 90}deg ${(i + 1) * 90}deg`,
).join(', ')})`

// How long one step of a token's move animation takes. A normal forward move
// hops cell-to-cell at a visible, trackable pace; a capture's trip back to
// the yard divides a fixed, short total across however many cells it passes
// — "faster", per feedback, regardless of how far it had traveled.
const FORWARD_STEP_MS = 170
const RETURN_HOME_TOTAL_MS = 420
// A single move is never more than a dice roll (max 6) forward, so a bigger
// forward gap only happens if this client missed several turns' worth of
// updates — safe to just snap in that case. A capture's reverse trip, though,
// can legitimately span the *entire* board (a token caught right before
// finishing has ~50 cells to retrace), so it gets a much higher cap — it
// should really only ever hit "too far, snap instead" for the same
// missed-many-turns reason as the forward case.
const MAX_FORWARD_STEPS = 10
const MAX_RETURN_STEPS = 60

/** The intermediate board positions a token passes through moving from
 * `fromPos` to `toPos` (backend position numbers, -1 = yard, 0-56 = track),
 * as {left, top} percentages — used to drive the step animation. Returns
 * `null` when the move is too large to sensibly animate (e.g. this client
 * missed several turns while disconnected), signaling "just snap instead". */
function buildMovePath(token, fromPos, toPos) {
  if (fromPos === toPos) return { steps: [], stepMs: FORWARD_STEP_MS }
  if (toPos === -1) {
    // Captured: retrace fromPos back down to the entry square, then home.
    if (fromPos < 0) return { steps: [], stepMs: FORWARD_STEP_MS }
    const cells = []
    for (let p = fromPos; p >= 0; p--) cells.push(trackPercent(token.color, p))
    cells.push(yardSlotPercent(token.color, token.index))
    if (cells.length > MAX_RETURN_STEPS) return null
    return { steps: cells, stepMs: Math.max(20, RETURN_HOME_TOTAL_MS / cells.length) }
  }
  if (fromPos === -1) {
    // Leaving the yard — always lands exactly on position 0.
    return { steps: [trackPercent(token.color, toPos)], stepMs: FORWARD_STEP_MS }
  }
  if (toPos < fromPos) return null // shouldn't happen; snap rather than guess
  const cells = []
  for (let p = fromPos + 1; p <= toPos; p++) cells.push(trackPercent(token.color, p))
  if (cells.length > MAX_FORWARD_STEPS) return null
  return { steps: cells, stepMs: FORWARD_STEP_MS }
}

const DIE_PIPS = {
  1: [[50, 50]],
  2: [[25, 25], [75, 75]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[25, 25], [25, 75], [75, 25], [75, 75]],
  5: [[25, 25], [25, 75], [50, 50], [75, 25], [75, 75]],
  6: [[25, 25], [25, 50], [25, 75], [75, 25], [75, 50], [75, 75]],
}

function DiePips({ value, dim }) {
  return (
    <>
      {DIE_PIPS[value].map(([top, left], i) => (
        <span
          key={i}
          className={`absolute h-[15%] w-[15%] -translate-x-1/2 -translate-y-1/2 rounded-full ${
            dim ? 'bg-ink-soft' : 'bg-ink'
          }`}
          style={{ top: `${top}%`, left: `${left}%` }}
        />
      ))}
    </>
  )
}

// A real cube: 6 faces placed in 3D with translateZ, opposite faces summing
// to 7 like a physical die. Needs pixel (not percentage) sizing for
// translateZ to mean anything, so the cube stays a fixed size regardless of
// how big the board itself is.
const CUBE_SIZE = 46
const HALF = CUBE_SIZE / 2
// How long the dice's tumble transition takes — shared with GamePage's own
// roll handling so a mandatory (only-one-legal-move) auto-move waits for the
// tumble to actually finish landing before it starts, rather than firing the
// moment the roll response arrives.
const DICE_TUMBLE_MS = 700
const FACE_VALUE = { front: 1, back: 6, right: 2, left: 5, top: 3, bottom: 4 }
const FACE_TRANSFORM = {
  front: `translateZ(${HALF}px)`,
  back: `rotateY(180deg) translateZ(${HALF}px)`,
  right: `rotateY(90deg) translateZ(${HALF}px)`,
  left: `rotateY(-90deg) translateZ(${HALF}px)`,
  top: `rotateX(90deg) translateZ(${HALF}px)`,
  bottom: `rotateX(-90deg) translateZ(${HALF}px)`,
}
// The container rotation that brings each face value to the front.
const FACE_ROTATION = {
  1: { x: 0, y: 0 },
  6: { x: 0, y: 180 },
  2: { x: 0, y: -90 },
  5: { x: 0, y: 90 },
  3: { x: -90, y: 0 },
  4: { x: 90, y: 0 },
}

function mod360(deg) {
  return ((deg % 360) + 360) % 360
}

/** The dice IS the control — clickable when it's your turn and no roll is
 * pending, disabled otherwise. `rotation` is an absolute {x, y} in degrees;
 * GamePage computes a new target (current + however much is needed to land
 * on the rolled face, plus a couple of extra full spins) on every fresh
 * roll and lets the CSS transition tumble the cube there — real 3D rotation
 * showing genuine faces in transit, not a simulated flat spin. Before the
 * first roll of the game, the cube just sits at its default orientation —
 * front face (1) showing — rather than a "?" placeholder.
 *
 * `active` (whose turn it is) and `clickable` (can this exact click do
 * something right now) are deliberately separate: `active` stays true for
 * your whole turn, including the moment after you've rolled and are
 * choosing a token to move, so the glow keeps identifying "this is your
 * turn" even while the die itself is briefly disabled again. */
function DiceCube({ rotation, active, clickable, onRoll }) {
  return (
    <div style={{ perspective: '260px' }}>
      <button
        type="button"
        onClick={onRoll}
        disabled={!clickable}
        aria-label="Roll the dice"
        className={`relative block ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
        style={{
          width: CUBE_SIZE,
          height: CUBE_SIZE,
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
          transition: `transform ${DICE_TUMBLE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`,
        }}
      >
        {Object.entries(FACE_TRANSFORM).map(([name, transform]) => (
          <div
            key={name}
            className={`absolute inset-0 flex items-center justify-center rounded-xl border-2 shadow-sm ${
              active ? 'border-ink/15 bg-white' : 'border-ink/10 bg-parchment'
            }`}
            style={{ transform, backfaceVisibility: 'hidden' }}
          >
            <DiePips value={FACE_VALUE[name]} dim={!active} />
          </div>
        ))}
        {active && (
          <span
            className="pointer-events-none absolute -inset-1.5 rounded-2xl animate-dice-glow"
            style={{ transform: 'translateZ(1px)' }}
          />
        )}
      </button>
    </div>
  )
}

/** A simplified pawn silhouette — a flared base, a tapered body, a collar
 * line, and a round head — built to read clearly at a small size: bold flat
 * fill, a dark outline (works against every yard color, not just some), no
 * gradients or shadows to keep it crisp rather than fussy. */
function PawnShape({ fill, className = '' }) {
  return (
    <svg viewBox="0 0 24 28" className={`h-full w-full ${className}`}>
      <path
        d="M8.6 11 L15.4 11 L18.5 24.7 Q18.7 26.2 17 26.2 L7 26.2 Q5.3 26.2 5.5 24.7 Z"
        fill={fill}
        stroke="#2b2b26"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="8.3" r="5" fill={fill} stroke="#2b2b26" strokeWidth="1.3" />
      <path
        d="M9 12.1 Q12 13 15 12.1"
        fill="none"
        stroke="#2b2b26"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Pawn({ token, clickable, onMove, busy, style, transitionMs }) {
  return (
    <button
      type="button"
      disabled={!clickable || busy}
      onClick={() => onMove(token.id)}
      aria-label={`${token.color} token`}
      className={`absolute -translate-x-1/2 -translate-y-1/2 ${
        clickable ? 'cursor-pointer hover:scale-110' : 'cursor-default'
      }`}
      style={{
        ...style,
        transition: `left ${transitionMs}ms linear, top ${transitionMs}ms linear`,
      }}
    >
      <PawnShape fill={COLOR_HEX[token.color]} className={clickable ? 'animate-token-shine' : ''} />
    </button>
  )
}

/** An empty yard slot — a faint dashed placeholder for a token that's
 * currently out on the track, so the yard still reads as "4 spots" the way a
 * physical board does. */
function EmptySlot({ color, style }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed"
      style={{ ...style, borderColor: `${COLOR_HEX[color]}50` }}
    />
  )
}

function Cell({ cell }) {
  if (cell.type === 'yard') {
    return <div className="h-full w-full" style={{ backgroundColor: COLOR_HEX[cell.color] }} />
  }
  if (cell.type === 'home') {
    return (
      <div
        className="h-full w-full border border-ink/15"
        style={{ backgroundColor: COLOR_HEX[cell.color] }}
      />
    )
  }
  if (cell.type === 'track') {
    return (
      <div
        className={`flex h-full w-full items-center justify-center border border-ink/15 ${
          cell.entryColor ? '' : 'bg-white'
        }`}
        style={cell.entryColor ? { backgroundColor: COLOR_HEX[cell.entryColor] } : undefined}
      >
        {cell.safe && (
          <svg
            viewBox="0 0 24 24"
            className={`h-1/2 w-1/2 ${cell.entryColor ? 'fill-ink' : cell.starColor ? '' : 'fill-ink-soft/60'}`}
            style={cell.starColor ? { fill: COLOR_HEX[cell.starColor] } : undefined}
          >
            <path d="M12 1l3.09 6.26L22 8.27l-5 4.87 1.18 6.88L12 16.9l-6.18 3.12L7 13.14 2 8.27l6.91-1.01L12 1z" />
          </svg>
        )}
      </div>
    )
  }
  return <div className="h-full w-full bg-white" />
}

/** Whose turn it is lives here, not on the board — a row of player chips, the
 * active one filled with their color. */
function TurnPanel({ players, currentTurnUserId }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 rounded-2xl border border-line bg-white p-3 shadow-sm">
      {players.map((p) => {
        const active = p.user.id === currentTurnUserId
        return (
          <div
            key={p.user.id}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all duration-300"
            style={
              active
                ? {
                    backgroundColor: COLOR_HEX[p.color],
                    color: 'white',
                    boxShadow: `0 2px 10px -2px ${COLOR_HEX[p.color]}aa`,
                  }
                : { backgroundColor: 'transparent', color: 'var(--color-ink-soft)' }
            }
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: active ? 'white' : COLOR_HEX[p.color] }}
            />
            {p.user.username}
          </div>
        )
      })}
    </div>
  )
}

export default function GamePage() {
  const { gameId: gameIdParam } = useParams()
  const gameId = Number(gameIdParam)
  const navigate = useNavigate()
  const { user: me } = useAuth()
  const [board, setBoard] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [diceRotation, setDiceRotation] = useState({ x: 0, y: 0 })
  const [diceRolling, setDiceRolling] = useState(false)
  const [confirmingQuit, setConfirmingQuit] = useState(false)
  const diceRotationRef = useRef({ x: 0, y: 0 })
  const prevRollSequenceRef = useRef(null)

  // Per-token animation state while a move is stepping along its path:
  // tokenId -> {left, top, ms}. A token not in this map just renders at its
  // real board position with no transition.
  const [animatingTokens, setAnimatingTokens] = useState({})
  const prevPositionsRef = useRef({}) // tokenId -> last known real position
  const stepTimersRef = useRef({}) // tokenId -> interval id, so a new move can cancel a stale one
  const autoMoveTimerRef = useRef(null) // pending mandatory (only-one-legal-move) auto-move, if any

  async function refresh() {
    try {
      setBoard(await api.getBoard(gameId))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    refresh()
    const stopWatching = watchGame(gameId, refresh)
    return stopWatching
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  // Dice: rotate to the new face the moment a fresh roll happens, for every
  // client watching — not just whoever clicked. Watches `roll_sequence`
  // rather than the rolled value, since a roll that auto-passes the turn
  // clears `dice_value` in the same response, and comparing values alone
  // would also miss it whenever the same face comes up twice in a row.
  useEffect(() => {
    if (!board || board.last_roll_value === null) return
    if (board.roll_sequence === prevRollSequenceRef.current) return
    prevRollSequenceRef.current = board.roll_sequence

    const target = FACE_ROTATION[board.last_roll_value]
    const cur = diceRotationRef.current
    const nextX = cur.x + mod360(target.x - mod360(cur.x)) + 720
    const nextY = cur.y + mod360(target.y - mod360(cur.y)) + 1080
    diceRotationRef.current = { x: nextX, y: nextY }
    setDiceRotation({ x: nextX, y: nextY })
    setDiceRolling(true)
    const t = setTimeout(() => setDiceRolling(false), DICE_TUMBLE_MS)
    return () => clearTimeout(t)
  }, [board?.roll_sequence])

  // Tokens: whenever a token's real position changes, animate it along its
  // actual path instead of just re-rendering at the new spot. This must run
  // BEFORE the browser paints (useLayoutEffect, not useEffect) — otherwise
  // React paints one frame at the token's new real position with no
  // transition (animatingTokens has no entry for it yet), and only then does
  // this effect kick in and animate backward from there to the path's first
  // step, producing a visible snap-then-rewind-then-replay glitch.
  //
  // A capture always lands on the exact square the moving token lands on,
  // so any token sent back to the yard (-1) in this same update was
  // necessarily captured by whichever token just moved forward in the same
  // update. Starting both animations at once made the capture look like it
  // fled a half-second before the capturing token actually got there — so
  // the capturing move is kicked off first, and a captured token's own trip
  // home is scheduled to start exactly when that move finishes landing
  // (not before, and not with any extra pause tacked on).
  useLayoutEffect(() => {
    if (!board) return

    const movedTokens = []
    for (const token of board.tokens) {
      const prevPos = prevPositionsRef.current[token.id]
      if (prevPos === undefined) {
        prevPositionsRef.current[token.id] = token.position
        continue
      }
      if (prevPos === token.position) continue
      prevPositionsRef.current[token.id] = token.position
      movedTokens.push({ token, prevPos })
    }
    if (movedTokens.length === 0) return

    // Starts one token's step-by-step animation; returns how long (ms) it
    // takes to finish, or undefined if it's too far to sensibly animate
    // (just snaps instead — see buildMovePath).
    function startPath(token, prevPos) {
      if (stepTimersRef.current[token.id]) clearInterval(stepTimersRef.current[token.id])

      const path = buildMovePath(token, prevPos, token.position)
      if (!path || path.steps.length === 0) return undefined

      let i = 0
      setAnimatingTokens((prev) => ({ ...prev, [token.id]: { ...path.steps[0], ms: path.stepMs } }))
      const id = setInterval(() => {
        i += 1
        if (i >= path.steps.length) {
          clearInterval(id)
          delete stepTimersRef.current[token.id]
          setAnimatingTokens((prev) => {
            const next = { ...prev }
            delete next[token.id]
            return next
          })
          return
        }
        setAnimatingTokens((prev) => ({ ...prev, [token.id]: { ...path.steps[i], ms: path.stepMs } }))
      }, path.stepMs)
      stepTimersRef.current[token.id] = id
      return path.steps.length * path.stepMs
    }

    const movers = movedTokens.filter((m) => m.token.position !== -1)
    const captured = movedTokens.filter((m) => m.token.position === -1 && m.prevPos !== -1)

    let moverDurationMs = 0
    for (const { token, prevPos } of movers) {
      const duration = startPath(token, prevPos)
      if (duration) moverDurationMs = Math.max(moverDurationMs, duration)
    }

    for (const { token, prevPos } of captured) {
      if (moverDurationMs > 0) {
        stepTimersRef.current[token.id] = setTimeout(() => startPath(token, prevPos), moverDurationMs)
      } else {
        startPath(token, prevPos)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.tokens])

  async function handleRoll() {
    setBusy(true)
    setError('')
    try {
      const newBoard = await api.rollDice(gameId)
      setBoard(newBoard)
      // Only one token can legally move — there's no real decision to make,
      // so move it automatically instead of making the player click it.
      // Waits for the dice's own tumble to actually finish landing first
      // (DICE_TUMBLE_MS) rather than firing the instant the roll response
      // arrives, so the roll and its consequence stay visually sequential.
      if (newBoard.my_movable_token_ids.length === 1) {
        const onlyTokenId = newBoard.my_movable_token_ids[0]
        autoMoveTimerRef.current = setTimeout(() => handleMove(onlyTokenId), DICE_TUMBLE_MS)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleMove(tokenId) {
    if (autoMoveTimerRef.current) {
      clearTimeout(autoMoveTimerRef.current)
      autoMoveTimerRef.current = null
    }
    setBusy(true)
    setError('')
    try {
      setBoard(await api.moveToken(gameId, tokenId))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleQuit() {
    setBusy(true)
    setError('')
    try {
      await api.cancelGame(gameId)
      await refresh()
      setConfirmingQuit(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!board) {
    return (
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <p className="text-sm text-ink-soft">Loading board…</p>
      </div>
    )
  }

  if (board.status === 'cancelled') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold">Game Cancelled</h1>
        <Card title="Game Cancelled">
          <p className="text-sm text-ink-soft">
            The creator ended this game early. It won't count on the leaderboard.
          </p>
          <Button onClick={() => navigate('/')} style={{ marginTop: '1rem' }}>
            Go to Dashboard
          </Button>
        </Card>
      </div>
    )
  }

  const myTurn = board.current_turn_user_id === me.id
  const movable = new Set(board.my_movable_token_ids)
  const ranked = board.players.filter((p) => p.rank !== null).sort((a, b) => a.rank - b.rank)
  const diceClickable = myTurn && board.dice_value === null && !busy && !diceRolling

  const filledYardSlots = new Set(
    board.tokens.filter((t) => t.position === -1).map((t) => `${t.color}:${t.index}`),
  )

  // Small nudges for tokens sharing one track cell, so they fan out instead
  // of stacking exactly on top of each other. Computed off each token's REAL
  // resting position (not mid-animation position) so the fan-out is stable.
  const FAN_OFFSETS = {
    1: [[0, 0]],
    2: [[-1.3, -1.3], [1.3, 1.3]],
    3: [[-1.5, -1.5], [1.5, -1.5], [0, 1.5]],
    4: [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]],
  }
  const groupByCell = {}
  for (const t of board.tokens) {
    if (t.position === -1) continue
    const { left, top } = tokenPercent(t)
    const key = `${left},${top}`
    ;(groupByCell[key] ??= []).push(t)
  }
  const offsetByTokenId = {}
  for (const group of Object.values(groupByCell)) {
    const fan = FAN_OFFSETS[group.length] ?? FAN_OFFSETS[4]
    group.forEach((t, i) => {
      offsetByTokenId[t.id] = fan[i]
    })
  }

  const isCreator = board.creator_id === me.id

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">
        {board.status === 'completed' ? 'Game Over' : "Let's Play"}
      </h1>
      <ErrorNote>{error}</ErrorNote>

      {board.status === 'completed' ? (
        <Card title="Final Standings">
          <ol className="space-y-2">
            {ranked.map((p) => (
              <li key={p.user.id} className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-parchment text-sm font-extrabold">
                  {p.rank}
                </span>
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: COLOR_HEX[p.color] }}
                />
                <span className="font-bold">{p.user.username}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-ink-soft">
            {board.confirmed_at
              ? 'Confirmed — this game counts on the leaderboard.'
              : 'Waiting on the admin to confirm this game before it counts on the leaderboard.'}
          </p>
        </Card>
      ) : confirmingQuit ? (
        <ConfirmBar
          message="Quit this game for everyone? It won't count on the leaderboard and can't be undone."
          confirmLabel="Yes, Quit Game"
          busy={busy}
          onCancel={() => setConfirmingQuit(false)}
          onConfirm={handleQuit}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <TurnPanel players={board.players} currentTurnUserId={board.current_turn_user_id} />
          </div>
          {isCreator && (
            <Button variant="subtle" onClick={() => setConfirmingQuit(true)}>
              Quit Game
            </Button>
          )}
        </div>
      )}

      <div
        className="relative mx-auto grid aspect-square w-full overflow-hidden rounded-2xl border-4 border-ink shadow-md"
        style={{ gridTemplateColumns: 'repeat(15, 1fr)', gridTemplateRows: 'repeat(15, 1fr)' }}
      >
        {CELL_GRID.map((row, r) =>
          row.map((cell, c) => (
            <div key={`${r},${c}`} style={{ gridRow: r + 1, gridColumn: c + 1 }}>
              <Cell cell={cell} />
            </div>
          )),
        )}

        {COLORS.map((color) => {
          const { left, top, size } = yardCardRect(color)
          return (
            <div
              key={color}
              className="absolute rounded-2xl bg-white shadow-inner"
              style={{ left: `${left}%`, top: `${top}%`, width: `${size}%`, height: `${size}%` }}
            />
          )
        })}

        {/* Center: the 4-color pinwheel, with the dice sitting on top of it. */}
        <div
          className="relative flex items-center justify-center rounded-2xl shadow-inner"
          style={{ gridRow: '7 / 10', gridColumn: '7 / 10', margin: '8%', background: PINWHEEL_GRADIENT }}
        >
          {board.status === 'active' && (
            <DiceCube
              rotation={diceRotation}
              active={myTurn}
              clickable={diceClickable}
              onRoll={handleRoll}
            />
          )}
        </div>

        {COLORS.flatMap((color) =>
          [0, 1, 2, 3]
            .filter((index) => !filledYardSlots.has(`${color}:${index}`))
            .map((index) => {
              const { left, top } = yardSlotPercent(color, index)
              return (
                <EmptySlot
                  key={`${color}-empty-${index}`}
                  color={color}
                  style={{ left: `${left}%`, top: `${top}%`, width: '5.4%', height: '5.4%' }}
                />
              )
            }),
        )}

        {board.tokens.map((token, i) => {
          const animating = animatingTokens[token.id]
          const { left, top } = animating ?? tokenPercent(token)
          const [dx, dy] = animating ? [0, 0] : (offsetByTokenId[token.id] ?? [0, 0])
          const clickable = myTurn && movable.has(token.id)
          return (
            <Pawn
              key={token.id}
              token={token}
              clickable={clickable}
              onMove={handleMove}
              busy={busy}
              transitionMs={animating ? animating.ms : 0}
              style={{
                left: `${left + dx}%`,
                top: `${top + dy}%`,
                width: '5%',
                height: '5%',
                zIndex: 10 + i,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
