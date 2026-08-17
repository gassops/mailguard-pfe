export type Verdict = 'VALID' | 'SUSPICIOUS' | 'INVALID'
export type Plan = 'free' | 'pro' | 'enterprise'
export type Severity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'

export interface ModuleResult {
  score: number
  maxScore: number
  weight: number
  severity: Severity
}

export interface BlacklistResult extends ModuleResult {
  flagged: boolean
  domain: string
  source: string
  isRoleEmail: boolean
  isTypo: boolean
}

export interface MXResult extends ModuleResult {
  valid: boolean
  records: string[]
  serverResponds: boolean
}

export interface SMTPResult extends ModuleResult {
  exists: boolean
  responseCode: number
  status: 'EXISTS' | 'NOT_FOUND' | 'UNKNOWN' | 'TIMEOUT'
}

export interface DomainAgeResult extends ModuleResult {
  days: number
  createdAt: string
  registrar: string
  riskLevel: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW'
}

export interface MLResult extends ModuleResult {
  probability: number
  topFeatures: { name: string; value: number; impact: 'positive' | 'negative' }[]
}

export interface CrowdsourceResult extends ModuleResult {
  reports: number
  validated: boolean
  threshold: number
}

export interface VerificationDetails {
  blacklist: BlacklistResult
  mx_check: MXResult
  smtp_check: SMTPResult
  domain_age: DomainAgeResult
  ml_classifier: MLResult
  crowdsource: CrowdsourceResult
}

export interface VerificationResult {
  email: string
  verdict: Verdict
  score: number
  reasons: string[]
  cached: boolean
  processingTimeMs: number
  details: VerificationDetails
  /** Essais gratuits restants (uniquement renseigné par /verify/free, sans compte) */
  freeRemaining?: number
}

export interface User {
  id: string
  email: string
  name: string
  plan: Plan
  apiKey?: string
}

export interface Quota {
  quotaUsed: number
  quotaLimit: number
  quotaResetAt: string
}

export interface AuthState {
  user: User | null
  apiKey: string | null
  isAuthenticated: boolean
}

export interface RegisterPayload { name: string; email: string; password: string }
export interface LoginPayload { email: string; password: string }
export interface AuthResponse { message: string; apiKey: string; name: string; email: string; quotaResetAt?: string }
