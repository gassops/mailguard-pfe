import type { Verdict, Severity, VerificationDetails } from '../types'

export function getVerdictColor(verdict: Verdict): string {
  return { VALID: '#16a34a', SUSPICIOUS: '#d97706', INVALID: '#dc2626' }[verdict]
}

export function getVerdictBg(verdict: Verdict): string {
  return {
    VALID: 'bg-green-50 border-green-200',
    SUSPICIOUS: 'bg-amber-50 border-amber-200',
    INVALID: 'bg-red-50 border-red-200',
  }[verdict]
}

export function getVerdictText(verdict: Verdict): string {
  return { VALID: 'text-green-700', SUSPICIOUS: 'text-amber-700', INVALID: 'text-red-700' }[verdict]
}

export function getSeverityClass(severity: Severity): string {
  return {
    NONE: 'text-green-700 bg-green-50 border-green-200',
    LOW: 'text-blue-700 bg-blue-50 border-blue-200',
    MEDIUM: 'text-amber-700 bg-amber-50 border-amber-200',
    HIGH: 'text-red-700 bg-red-50 border-red-200',
  }[severity]
}

export function getSeverityBarColor(severity: Severity): string {
  return { NONE: 'bg-green-500', LOW: 'bg-blue-500', MEDIUM: 'bg-amber-500', HIGH: 'bg-red-500' }[severity]
}

export function getRiskLabel(score: number): string {
  if (score <= 20) return 'Very Low Risk'
  if (score <= 40) return 'Low Risk'
  if (score <= 60) return 'Moderate Risk'
  if (score <= 80) return 'High Risk'
  return 'Very High Risk'
}

export function formatDomainAge(days: number): string {
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''}`
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) !== 1 ? 's' : ''}`
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) !== 1 ? 's' : ''}`
}

export function maskApiKey(key: string): string {
  if (key.length <= 10) return key
  return key.slice(0, 8) + '•'.repeat(16)
}

export function computeAggregator(details: VerificationDetails | undefined) {
  const map = [
    { name: 'Blacklist',     key: 'blacklist'     as const },
    { name: 'MX Record',    key: 'mx_check'      as const },
    { name: 'SMTP Check',   key: 'smtp_check'    as const },
    { name: 'Domain Age',   key: 'domain_age'    as const },
    { name: 'ML Classifier',key: 'ml_classifier' as const },
    { name: 'Crowdsource',  key: 'crowdsource'   as const },
  ]
  const components = map.map(m => {
    const mod      = details?.[m.key]
    const score    = mod?.score    ?? 0
    const maxScore = mod?.maxScore ?? 1
    const weight   = mod?.weight   ?? 0
    const contribution = (score / maxScore) * 100 * weight
    return { name: m.name, score, maxScore, weight, contribution: Math.round(contribution * 10) / 10 }
  })
  return { components, total: Math.round(components.reduce((acc, c) => acc + c.contribution, 0)) }
}
