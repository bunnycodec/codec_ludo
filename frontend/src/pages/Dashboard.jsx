/* Player Dashboard — the landing page after login.
 *
 * Game invites are refresh-on-demand rather than push, per the spec's
 * no-notifications design and the user's preference for a manual Refresh
 * button — players coordinate timing over WhatsApp, not in-app alerts.
 * Stats and the admin Confirm/Reject queue (Phase 5) share that same
 * refresh-on-demand pattern rather than live-updating. */

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'
import { Button, Card, ConfirmBar, EmptyState, ErrorNote, Loading } from '../components'

function statTiles(stats) {
  return [
    { label: 'Total Points', value: stats.total_points },
    { label: 'Games Played', value: stats.games_played },
    { label: 'Wins', value: stats.wins },
    { label: 'Win %', value: stats.win_percentage === null ? '—' : `${Math.round(stats.win_percentage)}%` },
    { label: 'Tokens Cut', value: stats.tokens_cut },
    { label: 'Sixes Rolled', value: stats.sixes_rolled },
  ]
}

function MyGames({ needsResponse, waiting, myPending, onRefresh, onRespond, busyId, error }) {
  const loading = needsResponse === null || waiting === null || myPending === null
  const empty =
    !loading && needsResponse.length === 0 && waiting.length === 0 && myPending.length === 0

  return (
    <Card
      title="Games"
      action={
        <Button variant="subtle" onClick={onRefresh}>
          Refresh
        </Button>
      }
    >
      <ErrorNote>{error}</ErrorNote>
      {loading ? (
        <Loading />
      ) : empty ? (
        <EmptyState>No pending invites or games waiting to start. Hit refresh if you're expecting one.</EmptyState>
      ) : (
        <div className="space-y-4">
          {needsResponse.length > 0 && (
            <ul className="divide-y divide-line">
              {needsResponse.map(({ game, invite }) => (
                <li key={invite.id} className="flex flex-wrap items-center gap-2 py-3">
                  <div>
                    <span className="font-bold">{game.creator.username}</span>
                    <span className="text-sm text-ink-soft"> invited you to a game</span>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <Button
                      variant="subtle"
                      disabled={busyId === invite.id}
                      onClick={() => onRespond(game.id, invite.id, 'decline')}
                    >
                      Decline
                    </Button>
                    <Button
                      disabled={busyId === invite.id}
                      onClick={() => onRespond(game.id, invite.id, 'accept')}
                    >
                      Accept
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {waiting.length > 0 && (
            <ul className="divide-y divide-line">
              {waiting.map((game) => (
                <li key={game.id} className="py-3">
                  <span className="font-bold">{game.creator.username}'s game</span>
                  <span className="ml-2 rounded-full bg-parchment px-2 py-0.5 text-xs font-bold text-ink-soft">
                    Waiting for {game.creator.username} to start
                  </span>
                </li>
              ))}
            </ul>
          )}
          {myPending.length > 0 && (
            <ul className="divide-y divide-line">
              {myPending.map((g) => (
                <li key={g.id} className="py-3">
                  <span className="font-bold">Finished #{g.rank}</span>
                  <span className="text-sm text-ink-soft"> — {g.points_if_confirmed} points if confirmed</span>
                  <span className="ml-2 rounded-full bg-parchment px-2 py-0.5 text-xs font-bold text-ink-soft">
                    Pending Confirmation
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function PendingConfirmations({ games, onConfirm, onReject, confirmBusyId, rejectingId, setRejectingId }) {
  const loading = games === null

  return (
    <Card
      title="Pending Confirmations"
      action={
        <span className="rounded-full bg-parchment px-2.5 py-0.5 text-xs font-bold text-ink-soft">
          {loading ? '…' : games.length}
        </span>
      }
    >
      {loading ? (
        <Loading />
      ) : games.length === 0 ? (
        <EmptyState>Finished games awaiting your Confirm/Reject will appear here.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {games.map((g) => (
            <li key={g.id} className="py-3">
              <ol className="space-y-1">
                {g.players.map((p) => (
                  <li key={p.user.id} className="flex items-center gap-2 text-sm">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-parchment text-xs font-extrabold">
                      {p.rank}
                    </span>
                    <span className="font-bold">{p.user.username}</span>
                    <span className="text-ink-soft">
                      +{p.points_if_confirmed} pts · {p.tokens_cut} cut · {p.sixes_rolled} sixes
                    </span>
                  </li>
                ))}
              </ol>

              {rejectingId === g.id ? (
                <ConfirmBar
                  className="mt-3"
                  message="Reject this game? It's deleted permanently — no stats, no trace, for anyone."
                  confirmLabel="Yes, Reject"
                  busy={confirmBusyId === g.id}
                  onCancel={() => setRejectingId(null)}
                  onConfirm={() => onReject(g.id)}
                />
              ) : (
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="subtle" onClick={() => setRejectingId(g.id)}>
                    Reject
                  </Button>
                  <Button disabled={confirmBusyId === g.id} onClick={() => onConfirm(g.id)}>
                    Confirm
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [activeGame, setActiveGame] = useState(null) // null = loading, undefined-ish "none" = false-y after load
  const [hasDraft, setHasDraft] = useState(null) // null = loading
  const [needsResponse, setNeedsResponse] = useState(null)
  const [waiting, setWaiting] = useState(null)
  const [myPending, setMyPending] = useState(null)
  const [stats, setStats] = useState(null)
  const [pendingConfirmations, setPendingConfirmations] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [confirmBusyId, setConfirmBusyId] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)

  // One shared refresh: the "Create Game" vs "Enter Room" vs blocked button state
  // and the Games card must always agree, so they're driven by the same fetch.
  async function refresh() {
    setError('')
    try {
      const [active, drafts, invited, accepted, mine, myStats] = await Promise.all([
        api.listActiveGames(),
        api.listPendingCreatedGames(),
        api.listPendingInvites(),
        api.listWaitingToStart(),
        api.listMyPendingConfirmations(),
        api.getMyStats(),
      ])
      setActiveGame(active[0] ?? false)
      setHasDraft(drafts.length > 0)
      setNeedsResponse(
        invited.map((g) => ({ game: g, invite: g.invites.find((i) => i.user.id === user.id) })),
      )
      setWaiting(accepted)
      setMyPending(mine)
      setStats(myStats)
      if (user.role === 'admin') {
        setPendingConfirmations(await api.listPendingConfirmations())
      }
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function respond(gameId, inviteId, action) {
    setBusyId(inviteId)
    setError('')
    try {
      await (action === 'accept' ? api.acceptInvite : api.declineInvite)(gameId, inviteId)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleConfirm(gameId) {
    setConfirmBusyId(gameId)
    setError('')
    try {
      await api.confirmGame(gameId)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirmBusyId(null)
    }
  }

  async function handleReject(gameId) {
    setConfirmBusyId(gameId)
    setError('')
    try {
      await api.rejectGame(gameId)
      setRejectingId(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirmBusyId(null)
    }
  }

  const loadingButton = activeGame === null || hasDraft === null
  // Already playing, or already committed to someone else's game (accepted, not
  // yet started)? Can't open a room of your own until that resolves — one game
  // at a time.
  const blockedByOtherGame =
    !loadingButton && !activeGame && !hasDraft && waiting !== null && waiting.length > 0

  function handleGameButton() {
    if (activeGame) navigate(`/game/${activeGame.id}`)
    else navigate('/build-game')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Hi, {user.username}</h1>
          <p className="text-sm text-ink-soft">Ready for a game?</p>
        </div>
        <Button
          onClick={handleGameButton}
          disabled={loadingButton || blockedByOtherGame}
          title={
            blockedByOtherGame
              ? "You've already joined another game — that one has to start or end first."
              : undefined
          }
        >
          {activeGame || hasDraft ? 'Enter Room' : 'Create Game'}
        </Button>
      </div>

      <Card title="Your Stats">
        {stats === null ? (
          <Loading />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {statTiles(stats).map((s) => (
                <div key={s.label} className="rounded-xl bg-parchment/60 px-4 py-3">
                  <div className="text-xl font-extrabold">{s.value}</div>
                  <div className="text-xs font-semibold text-ink-soft">{s.label}</div>
                </div>
              ))}
            </div>
            {stats.games_played === 0 && (
              <p className="mt-3 text-xs text-ink-soft">
                Stats fill in once games are played and confirmed.
              </p>
            )}
          </>
        )}
      </Card>

      <MyGames
        needsResponse={needsResponse}
        waiting={waiting}
        myPending={myPending}
        onRefresh={refresh}
        onRespond={respond}
        busyId={busyId}
        error={error}
      />

      {user.role === 'admin' && (
        <PendingConfirmations
          games={pendingConfirmations}
          onConfirm={handleConfirm}
          onReject={handleReject}
          confirmBusyId={confirmBusyId}
          rejectingId={rejectingId}
          setRejectingId={setRejectingId}
        />
      )}

      <Card title="Account">
        <Link to="/change-password" className="text-sm font-bold text-pine hover:underline">
          Change Password →
        </Link>
      </Card>
    </div>
  )
}
