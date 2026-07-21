/* The shared frame around every logged-in page: top bar with logo, navigation,
 * and logout. <Outlet /> is where the current page renders. */

import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from './auth'
import { Logo } from './components'

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${
          isActive ? 'bg-pine text-white' : 'text-ink-soft hover:bg-parchment'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 py-3">
          <div className="flex items-center gap-2 font-extrabold">
            <Logo />
            <span>Family Ludo</span>
          </div>
          <nav className="ml-auto flex flex-wrap items-center gap-1">
            <NavItem to="/">Dashboard</NavItem>
            <NavItem to="/leaderboard">Leaderboard</NavItem>
            {user?.role === 'admin' && <NavItem to="/family">Family</NavItem>}
            <NavItem to="/about">About</NavItem>
          </nav>
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-ink-soft hover:bg-parchment"
          >
            Log Out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
