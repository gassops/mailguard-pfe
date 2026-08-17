import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, Server, Mail, Clock, Brain, Users, ChevronDown } from 'lucide-react'
import type { ModuleResult, BlacklistResult, MXResult, SMTPResult, DomainAgeResult, MLResult, CrowdsourceResult } from '../../types'
import { getSeverityClass, getSeverityBarColor, formatDomainAge } from '../../utils/scoreHelpers'
import Badge from '../ui/Badge'
import type { MODULE_CONFIG } from '../../constants/modules'

const ICONS = { Shield, Server, Mail, Clock, Brain, Users }

interface Props {
  moduleKey: string
  config: typeof MODULE_CONFIG[number]
  data: ModuleResult
}

export default function ModuleCard({ moduleKey, config, data }: Props) {
  const [open, setOpen] = useState(false)
  const IconComp = ICONS[config.icon as keyof typeof ICONS]
  const pct = data.maxScore > 0 ? (data.score / data.maxScore) * 100 : 0
  const barColor = getSeverityBarColor(data.severity)

  function renderDetails() {
    switch (moduleKey) {
      case 'blacklist': {
        const d = data as BlacklistResult
        return (
          <div className="space-y-2 text-sm">
            <Row label="Flagged" value={d.flagged ? <span className="text-red-600 font-semibold">Yes</span> : <span className="text-green-600">No</span>} />
            {d.flagged && <Row label="Source" value={d.source} />}
            {d.isRoleEmail && <p className="text-amber-600 text-xs bg-amber-50 px-2 py-1 rounded">⚠ Role email detected (e.g. admin@, contact@)</p>}
            {d.isTypo && <p className="text-amber-600 text-xs bg-amber-50 px-2 py-1 rounded">⚠ Possible typo in domain</p>}
          </div>
        )
      }
      case 'mx_check': {
        const d = data as MXResult
        return (
          <div className="space-y-2 text-sm">
            <Row label="Valid" value={d.valid ? <span className="text-green-600">Yes</span> : <span className="text-red-600">No</span>} />
            <Row label="Server responds" value={d.serverResponds ? 'Yes' : 'No'} />
            {d.records.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">MX Records</p>
                {d.records.map(r => <p key={r} className="font-mono text-xs bg-gray-50 px-2 py-1 rounded">{r}</p>)}
              </div>
            )}
          </div>
        )
      }
      case 'smtp_check': {
        const d = data as SMTPResult
        return (
          <div className="space-y-2 text-sm">
            <Row label="Mailbox exists" value={d.exists ? <span className="text-green-600">Yes</span> : <span className="text-red-600">No</span>} />
            <Row label="Response code" value={<code>{d.responseCode}</code>} />
            <Row label="Status" value={d.status} />
            {d.status === 'UNKNOWN' && <p className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">ℹ Gmail/Outlook use catch-all — mailbox assumed valid</p>}
          </div>
        )
      }
      case 'domain_age': {
        const d = data as DomainAgeResult
        return (
          <div className="space-y-2 text-sm">
            <Row label="Domain age" value={formatDomainAge(d.days)} />
            <Row label="Created" value={d.createdAt} />
            <Row label="Registrar" value={d.registrar} />
            <Row label="Risk level" value={<Badge variant={d.riskLevel === 'LOW' ? 'none' : d.riskLevel === 'MODERATE' ? 'low' : 'high'}>{d.riskLevel}</Badge>} />
          </div>
        )
      }
      case 'ml_classifier': {
        const d = data as MLResult
        return (
          <div className="space-y-3 text-sm">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Disposable probability</span>
                <span className="font-semibold">{(d.probability * 100).toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className={`h-2 rounded-full ${d.probability > 0.7 ? 'bg-red-500' : d.probability > 0.4 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${d.probability * 100}%` }} />
              </div>
            </div>
            <div className="space-y-1">
              {d.topFeatures.map(f => (
                <div key={f.name} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{f.name}</span>
                  <span className={f.impact === 'negative' ? 'text-red-500' : 'text-green-600'}>{f.impact === 'negative' ? '−' : '+'} {f.value.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      }
      case 'crowdsource': {
        const d = data as CrowdsourceResult
        return (
          <div className="space-y-2 text-sm">
            <Row label="Validated" value={d.validated ? <span className="text-red-600 font-semibold">Yes</span> : <span className="text-green-600">No</span>} />
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Reports</span>
                <span>{d.reports} / {d.threshold} needed</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full bg-red-400" style={{ width: `${Math.min((d.reports / d.threshold) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
        )
      }
      default:
        return null
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button className="w-full p-4 text-left flex items-center gap-3 hover:bg-gray-50 transition" onClick={() => setOpen(v => !v)}>
        <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 shrink-0">
          <IconComp size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{config.name}</span>
            <span className="text-xs text-gray-400">×{config.weight}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${getSeverityClass(data.severity)}`}>{data.severity}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 bg-gray-100 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-medium text-gray-600 shrink-0">{data.score}/{data.maxScore}</span>
          </div>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={16} className="text-gray-400" />
        </motion.div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-400 mb-3">{config.description}</p>
              {renderDetails()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className="text-gray-800 text-xs font-medium">{value}</span>
    </div>
  )
}
