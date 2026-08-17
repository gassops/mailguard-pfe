import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Shield, Menu, X, ChevronDown, Sun, Moon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import Button from '../ui/Button'

export default function Navbar({ onLogin, onRegister }: { onLogin?: () => void; onRegister?: () => void }) {
  const { user, isAuthenticated, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handler)
    return () => window.removeEventListener('scroll', handler)
  }, [])

  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  function handleLogout() { logout(); setDropdownOpen(false); navigate('/') }

  const navLinks = [
    { label: 'Fonctionnalités', href: '/#fonctionnalites' },
    { label: 'Tarifs', href: '/pricing' },
    { label: 'Vérifier', href: '/verify' },
    { label: 'Documentation', href: '/docs' },
  ]

  return (
    <motion.nav
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? 'bg-gray-100/95 dark:bg-gray-800/95 backdrop-blur-xl shadow-md shadow-black/5'
          : 'bg-gray-100/80 dark:bg-gray-800/80 backdrop-blur-sm'
      } border-b border-gray-200 dark:border-gray-700`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 font-bold text-lg text-blue-700 dark:text-blue-400 hover:-translate-y-0.5 transition-transform duration-200">
          <Shield size={22} />
          MailGuard
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map(l => (
            <motion.div key={l.href} whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
              <Link
                to={l.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === l.href
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {l.label}
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* Dark mode toggle */}
          <button
            onClick={toggle}
            className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Changer le thème"
          >
            <AnimatePresence mode="wait">
              <motion.div key={dark ? 'sun' : 'moon'} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </motion.div>
            </AnimatePresence>
          </button>

          {/* Auth */}
          {isAuthenticated ? (
            <div className="relative hidden md:block">
              <button
                onClick={() => setDropdownOpen(v => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition text-sm text-gray-700 dark:text-gray-200"
              >
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </div>
                <span className="font-medium">{user?.name?.split(' ')[0]}</span>
                <ChevronDown size={14} />
              </button>
              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 z-50"
                  >
                    <Link to="/dashboard" onClick={() => setDropdownOpen(false)} className="block px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                      Tableau de bord
                    </Link>
                    <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                    <button onClick={handleLogout} className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
                      Déconnexion
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onLogin}>Connexion</Button>
              <Button variant="primary" size="sm" onClick={onRegister}>Essai gratuit</Button>
            </div>
          )}

          {/* Mobile burger */}
          <button
            className="md:hidden p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            onClick={() => setMenuOpen(v => !v)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden"
          >
            <div className="p-4 space-y-1">
              {navLinks.map(l => (
                <Link key={l.href} to={l.href} className="block px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                  {l.label}
                </Link>
              ))}
              <div className="border-t border-gray-100 dark:border-gray-800 pt-3 mt-2 flex gap-2">
                {isAuthenticated ? (
                  <>
                    <Link to="/dashboard" className="flex-1 text-center py-2 text-sm text-blue-600 font-medium">Tableau de bord</Link>
                    <button onClick={handleLogout} className="flex-1 text-center py-2 text-sm text-red-500">Déconnexion</button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => { setMenuOpen(false); onLogin?.() }}>Connexion</Button>
                    <Button variant="primary" size="sm" className="flex-1" onClick={() => { setMenuOpen(false); onRegister?.() }}>Essai gratuit</Button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
