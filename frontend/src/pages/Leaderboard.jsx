/* Leaderboard — every registered player's career stats (spec Section 12),
 * refresh-on-demand like the rest of the app rather than live-updating (stats
 * only change when the admin confirms a game elsewhere, not something worth
 * polling for).
 *
 * Rank always reflects standing by Total Points (computed server-side,
 * standard competition ranking — ties share a rank). Clicking a column
 * header re-sorts the *view* by that column; Rank itself never changes from
 * clicking a different column, so "who's actually winning" stays answerable
 * no matter what the table is currently sorted by. */

import { useEffect, useState } from 'react'
import * as api from '../api'
import { useAuth } from '../auth'
import { Button, Card, EmptyState, ErrorNote } from '../components'

const COLUMNS = [
  { key: 'rank', label: 'Rank' },
  { key: 'username', label: 'Player' },
  { key: 'total_points', label: 'Total Points' },
  { key: 'games_played', label: 'Games Played' },
  { key: 'wins', label: 'Wins' },
  { key: 'win_percentage', label: 'Win %' },
  { key: 'tokens_cut', label: 'Tokens Cut' },
  { key: 'sixes_rolled', label: 'Sixes Rolled' },
]

// Nulls (win_percentage with 0 games played) always sort last, regardless of
// direction — "no data yet" isn't meaningfully high or low.
function compareEntries(a, b, key, direction) {
  const va = a[key]
  const vb = b[key]
  if (va === null && vb === null) return 0
  if (va === null) return 1
  if (vb === null) return -1
  if (typeof va === 'string') {
    return direction === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
  }
  return direction === 'asc' ? va - vb : vb - va
}

export default function Leaderboard() {
  const { user: me } = useAuth()
  const [entries, setEntries] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [sort, setSort] = useState({ key: 'rank', direction: 'asc' })

  async function refresh() {
    setError('')
    try {
      setEntries(await api.getLeaderboard())
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function handleSort(key) {
    setSort((prev) => {
      if (prev.key === key) return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      // Sensible default per column: names read naturally A-Z, every stat
      // (rank included — 1st place first) reads naturally high-value/best first.
      return { key, direction: key === 'username' ? 'asc' : key === 'rank' ? 'asc' : 'desc' }
    })
  }

  const sorted = entries ? [...entries].sort((a, b) => compareEntries(a, b, sort.key, sort.direction)) : []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Leaderboard</h1>
        <Button variant="subtle" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Card>
        {entries === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : entries.length === 0 ? (
          <EmptyState>No confirmed games yet — the table fills in once games are played and the admin confirms them.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-bold text-ink-soft">
                  {COLUMNS.map((c) => {
                    const active = sort.key === c.key
                    return (
                      <th key={c.key} className="whitespace-nowrap px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleSort(c.key)}
                          className={`flex items-center gap-1 hover:text-ink ${active ? 'text-pine' : ''}`}
                        >
                          {c.label}
                          {active && <span aria-hidden="true">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry) => (
                  <tr
                    key={entry.id}
                    className={`border-b border-line last:border-0 ${
                      entry.id === me.id ? 'bg-parchment/60' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-extrabold">{entry.rank}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-bold">{entry.username}</td>
                    <td className="whitespace-nowrap px-3 py-2">{entry.total_points}</td>
                    <td className="whitespace-nowrap px-3 py-2">{entry.games_played}</td>
                    <td className="whitespace-nowrap px-3 py-2">{entry.wins}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {entry.win_percentage === null ? '—' : `${Math.round(entry.win_percentage)}%`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{entry.tokens_cut}</td>
                    <td className="whitespace-nowrap px-3 py-2">{entry.sixes_rolled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
