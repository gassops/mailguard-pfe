// Poids et scores maximaux : valeurs de repli, alignées sur WEIGHTS de api/src/services/scoreAggregator.js.
// L'interface affiche en priorité le poids renvoyé par l'API (data.weight), source de vérité.
export const MODULE_CONFIG = [
  { key: 'blacklist',     name: 'Domain Blacklist', icon: 'Shield', weight: 0.55, maxScore: 50, description: 'Checks against +100k known disposable email domains, updated weekly from GitHub.' },
  { key: 'mx_check',     name: 'MX Record',        icon: 'Server', weight: 0.10, maxScore: 20, description: 'Verifies the domain has valid Mail Exchanger DNS records and can receive emails.' },
  { key: 'smtp_check',   name: 'SMTP Check',       icon: 'Mail',   weight: 0.10, maxScore: 15, description: 'Attempts a real SMTP handshake to verify the mailbox exists — no email sent.' },
  { key: 'domain_age',   name: 'Domain Age',       icon: 'Clock',  weight: 0.07, maxScore: 10, description: 'Checks registration date via WHOIS — recently created domains are statistically riskier.' },
  { key: 'ml_classifier',name: 'ML Classifier',    icon: 'Brain',  weight: 0.15, maxScore: 15, description: 'Random Forest trained on thousands of domains — detects patterns invisible to rule-based checks.' },
  { key: 'crowdsource',  name: 'Crowdsource',      icon: 'Users',  weight: 0.03, maxScore: 50, description: 'Community-reported flags — 3 reports on a domain are required to apply a correction.' },
] as const
