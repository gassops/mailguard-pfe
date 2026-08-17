import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Copy, Check, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getStats } from '../services/api'
import { maskApiKey } from '../utils/scoreHelpers'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import Spinner from '../components/ui/Spinner'
import CodeSnippet from '../components/ui/CodeSnippet'
import EmailVerifier from '../components/verify/EmailVerifier'
import ResultCard from '../components/verify/ResultCard'
import type { VerificationResult } from '../types'

const CODE_TABS = ['cURL', 'Node.js', 'Python'] as const
type Tab = typeof CODE_TABS[number]

function getSnippet(tab: Tab, apiKey: string): string {
  if (tab === 'cURL') return `curl -X POST http://localhost:8080/api/v1/verify \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{"email": "utilisateur@exemple.com"}'`
  if (tab === 'Node.js') return `const axios = require('axios')

const { data } = await axios.post('http://localhost:8080/api/v1/verify',
  { email: 'utilisateur@exemple.com' },
  { headers: { 'X-API-Key': '${apiKey}' } }
)
console.log(data.verdict) // "VALID" | "SUSPICIOUS" | "INVALID"`
  return `import requests

res = requests.post(
    "http://localhost:8080/api/v1/verify",
    json={"email": "utilisateur@exemple.com"},
    headers={"X-API-Key": "${apiKey}"}
)
print(res.json()["verdict"])  # "VALID" | "SUSPICIOUS" | "INVALID"`
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-800',
    green:  'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-100 dark:border-green-800',
    yellow: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800',
    red:    'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wider opacity-60 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const { user, apiKey, quota, isAuthenticated, refreshQuota } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState<{ total: number; verdicts: { VALID: number; SUSPICIOUS: number; INVALID: number }; latence_moyenne_ms: number } | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('cURL')
  const [result, setResult] = useState<VerificationResult | null>(null)

  const fetchStats = async () => {
    try {
      const d = await getStats(30)
      setStats(d)
    } catch {
      setStats(null)
    } finally {
      setStatsLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) { navigate('/'); return }
    fetchStats()
    refreshQuota()
  }, [isAuthenticated, navigate, refreshQuota])

  async function handleVerifyResult(r: VerificationResult) {
    setResult(r)
    // Rafraîchit quota ET stats après chaque vérification
    await Promise.all([refreshQuota(), fetchStats()])
  }

  function copy() {
    if (!apiKey) return
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const displayKey = revealed ? (apiKey ?? '') : maskApiKey(apiKey ?? '')
  const codeKey = apiKey ?? 'VOTRE_CLE_API'

  if (!isAuthenticated) return null

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-4xl mx-auto px-4 space-y-6">

        {/* En-tête */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Bonjour, {user?.name?.split(' ')[0]} 👋
            </h1>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">Tableau de bord · 30 derniers jours</p>
          </div>
          <Badge variant="free">Plan gratuit</Badge>
        </div>

        {/* Quota mensuel */}
        {quota && (
          <Card className="p-6 dark:bg-gray-900 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Quota mensuel</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Renouvellement le {new Date(quota.quotaResetAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
              </span>
            </div>
            <div className="flex items-end gap-3 mb-3">
              <span className="text-3xl font-bold text-gray-900 dark:text-white">{quota.quotaUsed}</span>
              <span className="text-sm text-gray-400 dark:text-gray-500 mb-1">/ {quota.quotaLimit} vérifications</span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
              <motion.div
                className={`h-2.5 rounded-full transition-all ${
                  quota.quotaUsed / quota.quotaLimit >= 0.9
                    ? 'bg-red-500'
                    : quota.quotaUsed / quota.quotaLimit >= 0.7
                    ? 'bg-amber-500'
                    : 'bg-blue-600'
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (quota.quotaUsed / quota.quotaLimit) * 100)}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {quota.quotaLimit - quota.quotaUsed} restantes
              </span>
              {quota.quotaUsed / quota.quotaLimit >= 0.8 && (
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                  <AlertTriangle size={11} />
                  {quota.quotaUsed >= quota.quotaLimit ? 'Quota épuisé — passer au Pro' : 'Quota bientôt épuisé'}
                </span>
              )}
            </div>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statsLoading ? (
            <div className="col-span-4 flex justify-center py-8"><Spinner /></div>
          ) : (
            <>
              <StatCard label="Total vérifications" value={stats?.total ?? 0} color="blue" />
              <StatCard label="Valides"   value={stats?.verdicts?.VALID      ?? 0} color="green"  />
              <StatCard label="Suspects"  value={stats?.verdicts?.SUSPICIOUS  ?? 0} color="yellow" />
              <StatCard label="Invalides" value={stats?.verdicts?.INVALID     ?? 0} color="red"    />
            </>
          )}
        </div>

        {/* Clé API */}
        <Card className="p-6 dark:bg-gray-900 dark:border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Votre clé API</h2>
            <span className="text-xs bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-700 px-2 py-0.5 rounded-full">Active</span>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Ajoutez ce header à chaque requête : <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-700 dark:text-gray-300">X-API-Key: votre_clé</code>
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 font-mono text-sm text-gray-800 dark:text-gray-200 overflow-auto">
              {displayKey}
            </div>
            <button onClick={() => setRevealed(v => !v)} className="p-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition" title={revealed ? 'Masquer' : 'Afficher'}>
              {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button onClick={copy} className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition ${copied ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-900 dark:bg-gray-700 text-white hover:bg-gray-700 dark:hover:bg-gray-600'}`}>
              {copied ? <><Check size={14} /> Copié</> : <><Copy size={14} /> Copier</>}
            </button>
          </div>
        </Card>

        {/* Guide d'intégration */}
        <Card className="p-6 dark:bg-gray-900 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Guide d'intégration</h2>
          <div className="flex gap-1 mb-3 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
            {CODE_TABS.map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-4 py-1.5 text-xs rounded-md font-medium transition ${activeTab === t ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                {t}
              </button>
            ))}
          </div>
          <CodeSnippet code={getSnippet(activeTab, codeKey)} />
        </Card>

        {/* Vérification rapide */}
        <Card className="p-6 dark:bg-gray-900 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Tester un email</h2>
            {quota && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                quota.quotaUsed >= quota.quotaLimit
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
              }`}>
                {quota.quotaLimit - quota.quotaUsed} / {quota.quotaLimit} restantes
              </span>
            )}
          </div>
          <EmailVerifier
            onResult={handleVerifyResult}
            disabled={quota ? quota.quotaUsed >= quota.quotaLimit : false}
          />
          {quota && quota.quotaUsed >= quota.quotaLimit && (
            <p className="mt-3 text-xs text-center text-red-500 dark:text-red-400">
              Quota épuisé — les appels via clé API retournent 429.{' '}
              <a href="/pricing" className="underline">Passer au Pro</a>
            </p>
          )}
          {result && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
              <ResultCard result={result} onReset={() => setResult(null)} />
            </motion.div>
          )}
        </Card>
      </div>
    </motion.div>
  )
}
