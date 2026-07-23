/* Members Area (admin only) — the invite-only membership desk: list every
 * account, add a member with a temp password, reset someone's password. The
 * game is open to anyone, but only the admin can create accounts — there is
 * no public signup. Resetting a password also logs that person out everywhere
 * (the backend clears their session), so hand them the new temp password
 * directly. */

import { useEffect, useState } from 'react'
import * as api from '../api'
import { useAuth } from '../auth'
import { Button, Card, ConfirmBar, ErrorNote, Field, Loading, SuccessNote } from '../components'

export default function MembersArea() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState(null) // null = still loading
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Add-member form
  const [newName, setNewName] = useState('')
  const [newPass, setNewPass] = useState('')
  const [busy, setBusy] = useState(false)

  // Which user's reset form is open, and its temp-password value
  const [resetId, setResetId] = useState(null)
  const [resetPass, setResetPass] = useState('')

  // Which user is pending a delete confirmation
  const [deleteId, setDeleteId] = useState(null)

  async function refresh() {
    try {
      setUsers(await api.listUsers())
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const created = await api.createUser(newName, newPass)
      setNotice(`Account "${created.username}" created. Share the temp password with them.`)
      setNewName('')
      setNewPass('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleReset(e, userId, username) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api.resetPassword(userId, resetPass)
      setNotice(`Password reset for "${username}". They're logged out everywhere and must log in with the temp password.`)
      setResetId(null)
      setResetPass('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(userId, username) {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api.deleteUser(userId)
      setNotice(`Account "${username}" deleted.`)
      setDeleteId(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">Members Area</h1>
      <ErrorNote>{error}</ErrorNote>
      <SuccessNote>{notice}</SuccessNote>

      <Card title="Add a Member">
        <form onSubmit={handleAdd} className="space-y-4">
          <Field
            label="Username (letters, numbers, underscores)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            minLength={3}
            maxLength={30}
            required
          />
          <Field
            label="Temporary password (min 8 characters)"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            minLength={8}
            required
          />
          <Button type="submit" disabled={busy}>
            Create Account
          </Button>
        </form>
      </Card>

      <Card title="Members">
        {users === null ? (
          <Loading />
        ) : (
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{u.username}</span>
                  {u.role === 'admin' && (
                    <span className="rounded-full bg-pine px-2 py-0.5 text-xs font-bold text-white">
                      Admin
                    </span>
                  )}
                  {u.must_change_password && (
                    <span
                      className="rounded-full bg-parchment px-2 py-0.5 text-xs font-bold text-ink-soft"
                      title="Hasn't replaced their temp password yet"
                    >
                      Temp Password
                    </span>
                  )}
                  {u.id !== me.id && (
                    <div className="ml-auto flex gap-2">
                      <Button
                        variant="subtle"
                        onClick={() => {
                          setResetId(resetId === u.id ? null : u.id)
                          setResetPass('')
                          setDeleteId(null)
                        }}
                      >
                        Reset Password
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => {
                          setDeleteId(deleteId === u.id ? null : u.id)
                          setResetId(null)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
                {resetId === u.id && (
                  <form
                    onSubmit={(e) => handleReset(e, u.id, u.username)}
                    className="mt-3 flex flex-wrap items-end gap-2"
                  >
                    <div className="grow">
                      <Field
                        label="New temporary password (min 8 characters)"
                        value={resetPass}
                        onChange={(e) => setResetPass(e.target.value)}
                        minLength={8}
                        autoFocus
                        required
                      />
                    </div>
                    <Button type="submit" disabled={busy}>
                      Reset
                    </Button>
                  </form>
                )}
                {deleteId === u.id && (
                  <ConfirmBar
                    className="mt-3"
                    message={`Delete "${u.username}"? This removes their account permanently — it can't be undone.`}
                    confirmLabel="Yes, Delete"
                    busy={busy}
                    onCancel={() => setDeleteId(null)}
                    onConfirm={() => handleDelete(u.id, u.username)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
