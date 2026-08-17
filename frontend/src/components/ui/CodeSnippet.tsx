import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export default function CodeSnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const highlighted = code
    .replace(/(".*?")/g, '<span style="color:#86efac">$1</span>')
    .replace(/\b(curl|POST|GET|import|from|const|await|fetch|requests|print|def|async|return)\b/g, '<span style="color:#93c5fd">$1</span>')
    .replace(/(-H|-X|-d)/g, '<span style="color:#fbbf24">$1</span>')

  return (
    <div className="relative bg-[#0f1117] rounded-xl overflow-hidden">
      <button
        onClick={copy}
        className="absolute top-3 right-3 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition text-white"
        title="Copy code"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre className="p-5 text-sm font-mono text-gray-300 overflow-auto leading-relaxed" dangerouslySetInnerHTML={{ __html: highlighted }} />
    </div>
  )
}
