import type { ReactNode } from 'react'

interface CardProps { children: ReactNode; className?: string; hover?: boolean }

export default function Card({ children, className = '', hover }: CardProps) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl shadow-sm ${hover ? 'hover:shadow-md transition-shadow cursor-pointer' : ''} ${className}`}>
      {children}
    </div>
  )
}
