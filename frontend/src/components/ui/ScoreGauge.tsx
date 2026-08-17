import { motion } from 'framer-motion'
import type { Verdict } from '../../types'
import { getVerdictColor } from '../../utils/scoreHelpers'

interface ScoreGaugeProps { score: number; verdict: Verdict; size?: number }

export default function ScoreGauge({ score, verdict, size = 200 }: ScoreGaugeProps) {
  const r = 70
  const cx = 100
  const cy = 100
  const strokeWidth = 14
  const circumference = 2 * Math.PI * r
  const pct = Math.min(Math.max(score, 0), 100) / 100
  const offset = circumference * (1 - pct)
  const color = getVerdictColor(verdict)

  return (
    <svg width={size} height={size} viewBox="0 0 200 200">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
      <motion.circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="36" fontWeight="700" fontFamily="Inter, sans-serif">
        {score}
      </text>
      <text x={cx} y={cy + 22} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="13" fontWeight="600" fontFamily="Inter, sans-serif">
        {verdict}
      </text>
    </svg>
  )
}
