import { useState, useEffect } from 'react'

const MAX_CHECKS = 3
const STORAGE_KEY = 'mg_free_checks'

interface FreeCheckData { count: number; lastReset: string }

export function useFreeChecks() {
  const [checksUsed, setChecksUsed] = useState(0)

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data: FreeCheckData = JSON.parse(raw)
    const hoursDiff = (Date.now() - new Date(data.lastReset).getTime()) / 1000 / 3600
    if (hoursDiff >= 24) {
      localStorage.removeItem(STORAGE_KEY)
      setChecksUsed(0)
    } else {
      setChecksUsed(data.count)
    }
  }, [])

  function incrementCheck() {
    const raw = localStorage.getItem(STORAGE_KEY)
    const existing: FreeCheckData = raw ? JSON.parse(raw) : { count: 0, lastReset: new Date().toISOString() }
    const updated: FreeCheckData = { count: existing.count + 1, lastReset: existing.lastReset }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setChecksUsed(updated.count)
  }

  return {
    checksUsed,
    checksRemaining: Math.max(0, MAX_CHECKS - checksUsed),
    canCheck: checksUsed < MAX_CHECKS,
    incrementCheck,
  }
}
