/* Every backend call the app makes, in one place.
 *
 * All functions return the parsed JSON on success and throw an ApiError on
 * failure, so pages can show err.message directly. The auth cookie is httpOnly —
 * the browser attaches it automatically; this code never sees or handles tokens.
 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return null

  let data = null
  try {
    data = await res.json()
  } catch {
    // Non-JSON response (e.g. proxy error page) — fall through to generic message.
  }

  if (!res.ok) {
    // Session died mid-use (expired, or another device logged in). Announce it so
    // the auth provider can reset to logged-out — except for the login and
    // change-password endpoints, where a 401 just means "wrong password".
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/change-password') {
      window.dispatchEvent(new Event('session-expired'))
    }
    // FastAPI puts human-readable errors in "detail". Validation errors arrive as
    // a list of objects; reduce those to the first message.
    let message = 'Something went wrong. Please try again.'
    if (typeof data?.detail === 'string') message = data.detail
    else if (Array.isArray(data?.detail) && data.detail[0]?.msg) message = data.detail[0].msg
    throw new ApiError(res.status, message)
  }

  return data
}

// --- Auth ---
export const login = (username, password) =>
  request('/auth/login', { method: 'POST', body: { username, password } })

export const logout = () => request('/auth/logout', { method: 'POST' })

export const fetchMe = () => request('/auth/me')

export const changePassword = (currentPassword, newPassword) =>
  request('/auth/change-password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  })

// --- Admin (Manage Family) ---
export const listUsers = () => request('/admin/users')

export const createUser = (username, tempPassword) =>
  request('/admin/users', { method: 'POST', body: { username, temp_password: tempPassword } })

export const resetPassword = (userId, tempPassword) =>
  request(`/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: { temp_password: tempPassword },
  })

export const deleteUser = (userId) => request(`/admin/users/${userId}`, { method: 'DELETE' })

// --- Family roster (any logged-in user, for picking invitees) ---
export const listFamily = () => request('/users')

export const getMyStats = () => request('/users/me/stats')

// --- Games ---
export const createGame = (playerIds) =>
  request('/games', { method: 'POST', body: { player_ids: playerIds } })

export const listPendingInvites = () => request('/games/pending-invites')

export const listPendingCreatedGames = () => request('/games/pending-created')

export const listWaitingToStart = () => request('/games/waiting-to-start')

export const getGame = (gameId) => request(`/games/${gameId}`)

export const endGameRoom = (gameId) => request(`/games/${gameId}`, { method: 'DELETE' })

export const acceptInvite = (gameId, inviteId) =>
  request(`/games/${gameId}/invites/${inviteId}/accept`, { method: 'POST' })

export const declineInvite = (gameId, inviteId) =>
  request(`/games/${gameId}/invites/${inviteId}/decline`, { method: 'POST' })

export const replaceInvite = (gameId, inviteId, newUserId) =>
  request(`/games/${gameId}/invites/${inviteId}/replace`, {
    method: 'POST',
    body: { new_user_id: newUserId },
  })

export const startGame = (gameId) => request(`/games/${gameId}/start`, { method: 'POST' })

export const listActiveGames = () => request('/games/active-for-me')

export const cancelGame = (gameId) => request(`/games/${gameId}/cancel`, { method: 'POST' })

// --- Game lifecycle: admin Confirm/Reject queue (spec Section 9) ---
export const listPendingConfirmations = () => request('/games/pending-confirmation')

export const listMyPendingConfirmations = () => request('/games/my-pending-confirmation')

export const confirmGame = (gameId) => request(`/games/${gameId}/confirm`, { method: 'POST' })

export const rejectGame = (gameId) => request(`/games/${gameId}/reject`, { method: 'POST' })

// --- Gameplay (the live board) ---
export const getBoard = (gameId) => request(`/games/${gameId}/board`)

export const rollDice = (gameId) => request(`/games/${gameId}/roll`, { method: 'POST' })

export const moveToken = (gameId, tokenId) =>
  request(`/games/${gameId}/move`, { method: 'POST', body: { token_id: tokenId } })

// TESTING ONLY — see routes/debug.py. Part of the removable debug-tools set;
// delete these lines along with the others listed there to remove the feature.
export const forceDice = (value) => request(`/debug/force-dice/${value}`, { method: 'POST' })

export const finishGameNow = (gameId) =>
  request(`/debug/games/${gameId}/finish-now`, { method: 'POST' })
