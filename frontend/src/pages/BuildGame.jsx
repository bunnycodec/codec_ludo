/* Build the Game — creator picks 2-4 registered players (may include themselves,
 * which auto-accepts them) and sends invites, then watches responses come in.
 *
 * There's no push notification (by design — see spec Section 5), so this page is
 * refresh-on-demand: a Refresh button re-fetches the game instead of polling.
 * Reopening this page picks up any game you're still collecting invites for,
 * since the backend only lets one draft exist per creator at a time. */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'
import { Button, Card, ConfirmBar, ErrorNote, Loading, Select, SuccessNote } from '../components'

const STATUS_STYLES = {
  pending: 'bg-parchment text-ink-soft',
  accepted: 'bg-ludo-green/15 text-ludo-green',
  declined: 'bg-ludo-red/15 text-ludo-red',
  cancelled: 'bg-line text-ink-soft',
}

function StatusBadge({ status }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  )
}

function ReplacePicker({ members, game, invite, onDone, setError, setBusy, busy }) {
  const takenIds = new Set(game.invites.map((i) => i.user.id))
  const options = members.filter((u) => !takenIds.has(u.id))
  const [pick, setPick] = useState(options[0]?.id ?? '')

  async function handleResend(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const updated = await api.replaceInvite(game.id, invite.id, Number(pick))
      onDone(updated)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (options.length === 0) {
    return <p className="mt-2 text-xs text-ink-soft">No other members left to invite.</p>
  }

  return (
    <form onSubmit={handleResend} className="mt-2 flex flex-wrap items-center gap-2">
      <div className="min-w-[10rem] flex-1">
        <Select value={pick} onChange={(e) => setPick(e.target.value)}>
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="subtle" disabled={busy}>
        Resend Invite
      </Button>
    </form>
  )
}

function DraftGame({ game, setGame, members, onEnded }) {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [replacingId, setReplacingId] = useState(null)
  const [confirmingEnd, setConfirmingEnd] = useState(false)

  async function handleRefresh() {
    setError('')
    setBusy(true)
    try {
      setGame(await api.getGame(game.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleStart() {
    setError('')
    setBusy(true)
    try {
      await api.startGame(game.id)
      navigate(`/game/${game.id}`, { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function handleEndRoom() {
    setError('')
    setBusy(true)
    try {
      await api.endGameRoom(game.id)
      onEnded()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const acceptedCount = game.invites.filter((i) => i.status === 'accepted').length
  const canStart = acceptedCount >= 2

  return (
    <Card
      title="Waiting on Invites"
      action={
        <Button variant="subtle" onClick={handleRefresh} disabled={busy}>
          Refresh
        </Button>
      }
    >
      <ErrorNote>{error}</ErrorNote>
      <ul className="divide-y divide-line">
        {game.invites.map((invite) => (
          <li key={invite.id} className="py-3">
            <div className="flex items-center gap-2">
              <span className="font-bold">{invite.user.username}</span>
              {invite.user.id === game.creator.id && (
                <span className="text-xs text-ink-soft">(you)</span>
              )}
              <StatusBadge status={invite.status} />
              {invite.status === 'declined' && (
                <Button
                  variant="subtle"
                  onClick={() => setReplacingId(replacingId === invite.id ? null : invite.id)}
                  style={{ marginLeft: 'auto' }}
                >
                  Replace
                </Button>
              )}
            </div>
            {replacingId === invite.id && (
              <ReplacePicker
                members={members}
                game={game}
                invite={invite}
                busy={busy}
                setBusy={setBusy}
                setError={setError}
                onDone={(updated) => {
                  setGame(updated)
                  setReplacingId(null)
                  setNotice(`Invite resent.`)
                }}
              />
            )}
          </li>
        ))}
      </ul>
      <SuccessNote>{notice}</SuccessNote>

      {confirmingEnd ? (
        <ConfirmBar
          className="mt-4"
          message="End this room? Every invite is cancelled and this can't be undone."
          confirmLabel="Yes, End It"
          busy={busy}
          onCancel={() => setConfirmingEnd(false)}
          onConfirm={handleEndRoom}
        />
      ) : (
        <div className="mt-4 space-y-2">
          <Button onClick={handleStart} disabled={!canStart || busy} style={{ width: '100%' }}>
            {canStart ? 'Start Game' : `Start Game (Need ${2 - acceptedCount} More Accept${2 - acceptedCount === 1 ? '' : 's'})`}
          </Button>
          <Button
            variant="subtle"
            onClick={() => setConfirmingEnd(true)}
            disabled={busy}
            style={{ width: '100%' }}
          >
            End This Room &amp; Start Fresh
          </Button>
        </div>
      )}
    </Card>
  )
}

function NewGamePicker({ members, onCreated }) {
  const { user: me } = useAuth()
  const [selected, setSelected] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function toggle(id) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev,
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      onCreated(await api.createGame(selected))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Pick 2-4 Players">
      <form onSubmit={handleSubmit} className="space-y-4">
        <ul className="divide-y divide-line">
          {members.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2.5">
              <input
                type="checkbox"
                id={`player-${u.id}`}
                checked={selected.includes(u.id)}
                onChange={() => toggle(u.id)}
                disabled={!selected.includes(u.id) && selected.length >= 4}
                className="h-4 w-4 accent-pine"
              />
              <label htmlFor={`player-${u.id}`} className="text-sm font-semibold">
                {u.username} {u.id === me.id && <span className="text-ink-soft">(you)</span>}
              </label>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-soft">{selected.length} of 4 selected — pick at least 2.</p>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" disabled={selected.length < 2 || busy} style={{ width: '100%' }}>
          {busy ? 'Sending…' : 'Send Invites'}
        </Button>
      </form>
    </Card>
  )
}

export default function BuildGame() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [game, setGame] = useState(null)
  const [members, setMembers] = useState([])

  useEffect(() => {
    async function load() {
      try {
        const [drafts, memberList] = await Promise.all([
          api.listPendingCreatedGames(),
          api.listMembers(),
        ])
        setMembers(memberList)
        setGame(drafts[0] ?? null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">Build the Game</h1>
      <ErrorNote>{error}</ErrorNote>
      {loading ? (
        <Loading />
      ) : game ? (
        <DraftGame game={game} setGame={setGame} members={members} onEnded={() => setGame(null)} />
      ) : (
        <NewGamePicker members={members} onCreated={setGame} />
      )}
    </div>
  )
}
