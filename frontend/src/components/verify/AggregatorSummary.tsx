import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { VerificationDetails } from '../../types'
import { computeAggregator } from '../../utils/scoreHelpers'
import Card from '../ui/Card'

export default function AggregatorSummary({ details, finalScore }: { details: VerificationDetails | undefined; finalScore: number }) {
  const { components } = computeAggregator(details)
  if (!components.length) return null

  const colors = ['#2563eb', '#7c3aed', '#0891b2', '#d97706', '#16a34a', '#9333ea']

  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-gray-900 mb-1">Score Aggregator</h3>
      <p className="text-xs text-gray-400 mb-4">Weighted sum: Σ (score / max) × 100 × weight</p>

      <div className="overflow-x-auto mb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 text-gray-500 font-medium">Module</th>
              <th className="text-right py-2 text-gray-500 font-medium">Score</th>
              <th className="text-right py-2 text-gray-500 font-medium">Max</th>
              <th className="text-right py-2 text-gray-500 font-medium">Weight</th>
              <th className="text-right py-2 text-gray-500 font-medium">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {components.map(c => (
              <tr key={c.name} className="border-b border-gray-50">
                <td className="py-2 text-gray-700">{c.name}</td>
                <td className="py-2 text-right font-mono text-gray-600">{c.score}</td>
                <td className="py-2 text-right font-mono text-gray-400">{c.maxScore}</td>
                <td className="py-2 text-right text-gray-500">{(c.weight * 100).toFixed(0)}%</td>
                <td className="py-2 text-right font-semibold text-blue-600">{c.contribution.toFixed(1)}</td>
              </tr>
            ))}
            <tr className="bg-gray-50">
              <td colSpan={4} className="py-2 text-right font-bold text-gray-900 pr-2">Total</td>
              <td className="py-2 text-right font-bold text-blue-700">{finalScore}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={components} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} />
            <YAxis tick={{ fontSize: 9 }} />
            <Tooltip formatter={(v: number) => v.toFixed(1)} />
            <Bar dataKey="contribution" radius={[4, 4, 0, 0]}>
              {components.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
