import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Button from '../ui/Button'
import CodeSnippet from '../ui/CodeSnippet'

const TABS = ['cURL', 'Node.js', 'Python'] as const
type Tab = typeof TABS[number]

function getSnippet(tab: Tab, apiKey: string): string {
  if (tab === 'cURL') return `curl -X POST http://localhost:5173/api/v1/verify \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{"email": "user@example.com"}'`
  if (tab === 'Node.js') return `const axios = require('axios')

const res = await axios.post('http://localhost:5173/api/v1/verify',
  { email: 'user@example.com' },
  { headers: { 'X-API-Key': '${apiKey}' } }
)
console.log(res.data.verdict) // "VALID" | "SUSPICIOUS" | "INVALID"`
  return `import requests

res = requests.post(
    "http://localhost:5173/api/v1/verify",
    json={"email": "user@example.com"},
    headers={"X-API-Key": "${apiKey}"}
)
print(res.json()["verdict"])  # "VALID" | "SUSPICIOUS" | "INVALID"`
}

interface Props { isOpen: boolean; apiKey: string; onClose: () => void }

export default function ApiKeyRevealModal({ isOpen, apiKey, onClose }: Props) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('cURL')

  function copy() {
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleClose() {
    localStorage.setItem('mg_api_key_revealed', 'true')
    onClose()
    navigate('/dashboard')
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8 z-10 max-h-[90vh] overflow-y-auto"
          >
            <div className="text-center mb-6">
              <div className="text-4xl mb-2">🎉</div>
              <h2 className="text-xl font-bold text-gray-900">Your account is ready!</h2>
              <p className="text-sm text-gray-500 mt-1">Your API key has been generated</p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-700 font-medium">
              ⚠ Copy your API key now — it won't be shown in full again after you close this window.
            </div>

            <div className="flex items-center gap-2 mb-6">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono text-gray-800 overflow-auto">
                {apiKey}
              </code>
              <button onClick={copy} className={`shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition ${copied ? 'bg-green-100 text-green-700' : 'bg-gray-900 text-white hover:bg-gray-700'}`}>
                {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>

            <div className="mb-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Integration guide</p>
              <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-1">
                {TABS.map(t => (
                  <button key={t} onClick={() => setActiveTab(t)}
                    className={`flex-1 text-xs py-1.5 rounded-md font-medium transition ${activeTab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
                  >{t}</button>
                ))}
              </div>
              <CodeSnippet code={getSnippet(activeTab, apiKey)} />
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-6 text-xs text-blue-700 flex gap-4">
              <div><span className="font-semibold">100</span> checks/month</div>
              <div><span className="font-semibold">10 req</span>/min rate limit</div>
              <div><span className="font-semibold">Free</span> forever</div>
            </div>

            <Button className="w-full" size="lg" onClick={handleClose}>Go to Dashboard →</Button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
