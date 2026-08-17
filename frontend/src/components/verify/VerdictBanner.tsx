import type { VerificationResult } from '../../types'
import ScoreGauge from '../ui/ScoreGauge'
import { getVerdictBg, getVerdictText, getRiskLabel } from '../../utils/scoreHelpers'

export default function VerdictBanner({ result }: { result: VerificationResult }) {
  return (
    <div className={`rounded-2xl border p-6 flex flex-col md:flex-row items-center gap-6 ${getVerdictBg(result.verdict)}`}>
      <ScoreGauge score={result.score} verdict={result.verdict} size={140} />
      <div className="flex-1 text-center md:text-left">
        <p className={`text-3xl font-bold tracking-tight ${getVerdictText(result.verdict)}`}>{result.verdict}</p>
        <p className="text-gray-500 font-mono text-sm mt-1">{result.email}</p>
        <p className={`text-sm font-medium mt-1 ${getVerdictText(result.verdict)}`}>{getRiskLabel(result.score)}</p>
        {result.reasons.length > 0 && (
          <ul className="mt-3 space-y-1">
            {result.reasons.map((r, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">›</span>{r}
              </li>
            ))}
          </ul>
        )}
        {result.reasons.length === 0 && (
          <p className="mt-2 text-sm text-green-600 font-medium">✓ No issues detected</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2 text-xs text-gray-500 shrink-0">
        <span className="px-2.5 py-1 bg-white/70 rounded-full border border-gray-200">{result.processingTimeMs}ms</span>
        {result.cached && <span className="px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full border border-blue-200">Cached</span>}
      </div>
    </div>
  )
}
