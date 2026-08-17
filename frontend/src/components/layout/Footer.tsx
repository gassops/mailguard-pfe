import { Shield } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-semibold">
          <Shield size={18} />
          MailGuard
        </div>
        <div className="flex items-center gap-6 text-sm text-gray-500 dark:text-gray-400">
          <Link to="/pricing" className="hover:text-gray-900 dark:hover:text-white transition">Tarifs</Link>
          <Link to="/verify" className="hover:text-gray-900 dark:hover:text-white transition">Vérifier</Link>
          <Link to="/docs" className="hover:text-gray-900 dark:hover:text-white transition">Documentation</Link>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-600">© 2026 MailGuard · Projet PFE</p>
      </div>
    </footer>
  )
}
