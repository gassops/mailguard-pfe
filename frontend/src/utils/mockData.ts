import type { VerificationResult } from '../types'

export const MOCK_INVALID: VerificationResult = {
  email: 'user@mailinator.com',
  verdict: 'INVALID',
  score: 87,
  reasons: ['Domaine disposable détecté (blacklist)', 'ML classifier: probabilité 95%', 'Signalé 142 fois par la communauté'],
  cached: false,
  processingTimeMs: 142,
  details: {
    blacklist: { score: 50, maxScore: 50, weight: 0.40, severity: 'HIGH', flagged: true, domain: 'mailinator.com', source: 'GitHub disposable list', isRoleEmail: false, isTypo: false },
    mx_check: { score: 0, maxScore: 20, weight: 0.15, severity: 'NONE', valid: true, records: ['mail.mailinator.com'], serverResponds: true },
    smtp_check: { score: 0, maxScore: 15, weight: 0.15, severity: 'NONE', exists: true, responseCode: 250, status: 'EXISTS' },
    domain_age: { score: 0, maxScore: 10, weight: 0.10, severity: 'NONE', days: 4521, createdAt: '2012-03-14', registrar: 'Namecheap', riskLevel: 'LOW' },
    ml_classifier: { score: 14, maxScore: 15, weight: 0.15, severity: 'HIGH', probability: 0.95, topFeatures: [{ name: 'Domain entropy', value: 0.87, impact: 'negative' }, { name: 'Suspicious keywords', value: 0.92, impact: 'negative' }, { name: 'TLD risk score', value: 0.61, impact: 'negative' }] },
    crowdsource: { score: 23, maxScore: 15, weight: 0.05, severity: 'HIGH', reports: 142, validated: true, threshold: 3 },
  },
}

export const MOCK_SUSPICIOUS: VerificationResult = {
  email: 'contact@newstartup.xyz',
  verdict: 'SUSPICIOUS',
  score: 38,
  reasons: ['Domaine créé il y a 12 jours', 'TLD risqué (.xyz)', 'Email de rôle détecté (contact@)'],
  cached: false,
  processingTimeMs: 287,
  details: {
    blacklist: { score: 0, maxScore: 50, weight: 0.40, severity: 'NONE', flagged: false, domain: 'newstartup.xyz', source: '', isRoleEmail: true, isTypo: false },
    mx_check: { score: 0, maxScore: 20, weight: 0.15, severity: 'NONE', valid: true, records: ['mail.newstartup.xyz'], serverResponds: true },
    smtp_check: { score: 0, maxScore: 15, weight: 0.15, severity: 'NONE', exists: true, responseCode: 250, status: 'EXISTS' },
    domain_age: { score: 7, maxScore: 10, weight: 0.10, severity: 'HIGH', days: 12, createdAt: '2026-05-06', registrar: 'GoDaddy', riskLevel: 'HIGH' },
    ml_classifier: { score: 8, maxScore: 15, weight: 0.15, severity: 'MEDIUM', probability: 0.54, topFeatures: [{ name: 'TLD risk score', value: 0.71, impact: 'negative' }, { name: 'Domain length', value: 0.42, impact: 'negative' }, { name: 'Digit presence', value: 0.10, impact: 'positive' }] },
    crowdsource: { score: 0, maxScore: 15, weight: 0.05, severity: 'NONE', reports: 1, validated: false, threshold: 3 },
  },
}

export const MOCK_VALID: VerificationResult = {
  email: 'john.doe@gmail.com',
  verdict: 'VALID',
  score: 4,
  reasons: [],
  cached: true,
  processingTimeMs: 12,
  details: {
    blacklist: { score: 0, maxScore: 50, weight: 0.40, severity: 'NONE', flagged: false, domain: 'gmail.com', source: '', isRoleEmail: false, isTypo: false },
    mx_check: { score: 0, maxScore: 20, weight: 0.15, severity: 'NONE', valid: true, records: ['alt1.gmail-smtp-in.l.google.com', 'gmail-smtp-in.l.google.com'], serverResponds: true },
    smtp_check: { score: 0, maxScore: 15, weight: 0.15, severity: 'NONE', exists: true, responseCode: 250, status: 'UNKNOWN' },
    domain_age: { score: 0, maxScore: 10, weight: 0.10, severity: 'NONE', days: 8127, createdAt: '2004-03-30', registrar: 'Google LLC', riskLevel: 'LOW' },
    ml_classifier: { score: 1, maxScore: 15, weight: 0.15, severity: 'NONE', probability: 0.03, topFeatures: [{ name: 'Domain reputation', value: 0.98, impact: 'positive' }, { name: 'Domain age', value: 0.95, impact: 'positive' }, { name: 'TLD risk score', value: 0.02, impact: 'positive' }] },
    crowdsource: { score: 0, maxScore: 15, weight: 0.05, severity: 'NONE', reports: 0, validated: false, threshold: 3 },
  },
}

export function getMockResult(email: string): VerificationResult {
  const domain = email.split('@')[1] || ''
  const disposable = ['mailinator.com', 'tempmail.com', 'guerrillamail.com', 'yopmail.com', 'throwamail.com']
  if (disposable.includes(domain)) return { ...MOCK_INVALID, email }
  if (['.xyz', '.top', '.click', '.tk', '.ml'].some(t => domain.endsWith(t))) return { ...MOCK_SUSPICIOUS, email }
  return { ...MOCK_VALID, email }
}
