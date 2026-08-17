import type { ReactNode } from 'react'

type BadgeVariant = 'valid' | 'suspicious' | 'invalid' | 'none' | 'low' | 'medium' | 'high' | 'free' | 'pro' | 'enterprise'

const styles: Record<BadgeVariant, string> = {
  valid:      'bg-green-100 text-green-700 border-green-200',
  suspicious: 'bg-amber-100 text-amber-700 border-amber-200',
  invalid:    'bg-red-100 text-red-700 border-red-200',
  none:       'bg-green-100 text-green-700 border-green-200',
  low:        'bg-blue-100 text-blue-700 border-blue-200',
  medium:     'bg-amber-100 text-amber-700 border-amber-200',
  high:       'bg-red-100 text-red-700 border-red-200',
  free:       'bg-gray-100 text-gray-600 border-gray-200',
  pro:        'bg-blue-100 text-blue-700 border-blue-200',
  enterprise: 'bg-stone-100 text-stone-700 border-stone-200',
}

export default function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[variant]}`}>
      {children}
    </span>
  )
}
