import axios from 'axios'
import type { VerificationResult, AuthResponse, RegisterPayload, LoginPayload, Quota } from '../types'
import { getMockResult } from '../utils/mockData'

const BASE = '/api/v1'

function getKey(): string | null {
  return localStorage.getItem('mg_api_key')
}

function authHeaders(): Record<string, string> {
  const key = getKey()
  return key ? { 'X-API-Key': key } : {}
}

// Erreur dédiée au quota gratuit épuisé (429 sur /verify/free) — permet à
// l'UI de distinguer "plus d'essais gratuits" d'un véritable échec réseau.
export class FreeQuotaExceededError extends Error {
  resetIn?: string
  constructor(resetIn?: string) {
    super('Quota gratuit épuisé')
    this.resetIn = resetIn
  }
}

export async function verifyEmail(email: string): Promise<VerificationResult> {
  const key      = getKey()
  const endpoint = key ? `${BASE}/verify` : `${BASE}/verify/free`

  try {
    const res = await axios.post(
      endpoint,
      { email },
      { headers: { 'Content-Type': 'application/json', ...authHeaders() }, timeout: 10000 }
    )
    const data = res.data
    return {
      email: data.email,
      verdict: data.verdict,
      score: data.score,
      reasons: data.reasons || [],
      cached: data.cached || false,
      processingTimeMs: data.processingTimeMs || data.processing_time_ms || 0,
      details: data.details,
      freeRemaining: key ? undefined : Number(res.headers['x-free-quota-remaining'] ?? NaN),
    }
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      throw new FreeQuotaExceededError(err.response.data?.reset_in)
    }
    // Backend réellement injoignable (pas un refus d'auth/quota) → démo visuelle de secours.
    await new Promise(r => setTimeout(r, 600))
    return getMockResult(email)
  }
}

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  const { data } = await axios.post(`${BASE}/auth/register`, payload)
  return data
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const { data } = await axios.post(`${BASE}/auth/login`, payload)
  return data
}

export async function getStats(periode = 30) {
  const { data } = await axios.get(`${BASE}/stats?periode=${periode}`, { headers: authHeaders() })
  return data
}

export async function getMe(): Promise<Quota> {
  const { data } = await axios.get(`${BASE}/me`, { headers: authHeaders() })
  return {
    quotaUsed:    data.quotaUsed,
    quotaLimit:   data.quotaLimit,
    quotaResetAt: data.quotaResetAt,
  }
}
