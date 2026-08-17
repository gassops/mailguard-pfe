export const MODULE_CONFIG = [
  { key: 'blacklist',     name: 'Domain Blacklist', icon: 'Shield', weight: 0.40, maxScore: 50, description: 'Checks against +100k known disposable email domains, updated weekly from GitHub.' },
  { key: 'mx_check',     name: 'MX Record',        icon: 'Server', weight: 0.15, maxScore: 20, description: 'Verifies the domain has valid Mail Exchanger DNS records and can receive emails.' },
  { key: 'smtp_check',   name: 'SMTP Check',       icon: 'Mail',   weight: 0.15, maxScore: 15, description: 'Attempts a real SMTP handshake to verify the mailbox exists — no email sent.' },
  { key: 'domain_age',   name: 'Domain Age',       icon: 'Clock',  weight: 0.10, maxScore: 10, description: 'Checks registration date via WHOIS — recently created domains are statistically riskier.' },
  { key: 'ml_classifier',name: 'ML Classifier',    icon: 'Brain',  weight: 0.15, maxScore: 15, description: 'Random Forest trained on thousands of domains — detects patterns invisible to rule-based checks.' },
  { key: 'crowdsource',  name: 'Crowdsource',      icon: 'Users',  weight: 0.05, maxScore: 15, description: 'Community-reported flags — 3 independent reports required to apply a correction.' },
] as const
