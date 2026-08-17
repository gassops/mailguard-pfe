import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { User, RegisterPayload, LoginPayload, Quota } from '../types'
import { register as apiRegister, login as apiLogin, getMe } from '../services/api'

interface AuthContextValue {
  user: User | null
  apiKey: string | null
  quota: Quota | null
  isAuthenticated: boolean
  login: (payload: LoginPayload) => Promise<string>
  register: (payload: RegisterPayload) => Promise<string>
  logout: () => void
  refreshQuota: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialisation synchrone depuis localStorage — évite la redirection sur F5
  const [user, setUser]     = useState<User | null>(() => {
    try { const s = localStorage.getItem('mg_user'); return s ? JSON.parse(s) : null } catch { return null }
  })
  const [apiKey, setApiKey] = useState<string | null>(() => localStorage.getItem('mg_api_key'))
  const [quota, setQuota]   = useState<Quota | null>(null)

  const refreshQuota = useCallback(async () => {
    if (!localStorage.getItem('mg_api_key')) return
    try {
      const q = await getMe()
      setQuota(q)
    } catch {
      // fail silently — quota will show null
    }
  }, [])

  // Charge le quota au démarrage si une session est déjà stockée
  useEffect(() => {
    if (apiKey) {
      getMe().then(setQuota).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function login(payload: LoginPayload): Promise<string> {
    const data = await apiLogin(payload)
    const u: User = { id: data.email, email: data.email, name: data.name, plan: 'free' }
    setUser(u)
    setApiKey(data.apiKey)
    localStorage.setItem('mg_user', JSON.stringify(u))
    localStorage.setItem('mg_api_key', data.apiKey)
    // Fetch quota right after login
    getMe().then(setQuota).catch(() => {})
    return data.apiKey
  }

  async function register(payload: RegisterPayload): Promise<string> {
    const data = await apiRegister(payload)
    const u: User = { id: data.email, email: data.email, name: data.name, plan: 'free' }
    setUser(u)
    setApiKey(data.apiKey)
    localStorage.setItem('mg_user', JSON.stringify(u))
    localStorage.setItem('mg_api_key', data.apiKey)
    // Fresh account — quota starts at 0
    setQuota({ quotaUsed: 0, quotaLimit: 100, quotaResetAt: data.quotaResetAt ?? '' })
    return data.apiKey
  }

  function logout() {
    setUser(null)
    setApiKey(null)
    setQuota(null)
    localStorage.removeItem('mg_user')
    localStorage.removeItem('mg_api_key')
    localStorage.removeItem('mg_api_key_revealed')
  }

  return (
    <AuthContext.Provider value={{ user, apiKey, quota, isAuthenticated: !!user, login, register, logout, refreshQuota }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
