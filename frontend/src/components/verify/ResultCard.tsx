import { motion } from 'framer-motion'
import { Copy, RefreshCw } from 'lucide-react'
import { toast } from 'react-hot-toast'
import type { VerificationResult } from '../../types'
import { MODULE_CONFIG } from '../../constants/modules'
import VerdictBanner from './VerdictBanner'
import ModuleCard from './ModuleCard'
import AggregatorSummary from './AggregatorSummary'
import Button from '../ui/Button'

export default function ResultCard({ result, onReset }: { result: VerificationResult; onReset?: () => void }) {
  function copyJson() {
    navigator.clipboard.writeText(JSON.stringify(result, null, 2))
    toast.success('JSON copied to clipboard')
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      className="space-y-4"
    >
      <VerdictBanner result={result} />

      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">6-Module Analysis</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MODULE_CONFIG.map(config => {
            const key = config.key as keyof typeof result.details
            const data = result.details?.[key]
            if (!data) return null
            return <ModuleCard key={config.key} moduleKey={config.key} config={config} data={data} />
          })}
        </div>
      </div>

      <AggregatorSummary details={result.details} finalScore={result.score} />

      <div className="flex items-center gap-3 justify-end">
        <Button variant="outline" size="sm" icon={<Copy size={14} />} onClick={copyJson}>Copy JSON</Button>
        {onReset && <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={onReset}>Analyze Another</Button>}
      </div>
    </motion.div>
  )
}
