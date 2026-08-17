import { useState } from 'react'
import { motion } from 'framer-motion'
import type { VerificationResult } from '../types'
import { useAuth } from '../context/AuthContext'
import { useFreeChecks } from '../hooks/useFreeChecks'
import EmailVerifier from '../components/verify/EmailVerifier'
import ResultCard from '../components/verify/ResultCard'
import Button from '../components/ui/Button'

export default function Verify({ onRegister }: { onRegister?: () => void }) {
  const { isAuthenticated } = useAuth()
  const { checksUsed, checksRemaining, canCheck, incrementCheck } = useFreeChecks()
  const [result, setResult] = useState<VerificationResult | null>(null)

  function handleResult(r: VerificationResult) {
    if (!isAuthenticated) incrementCheck()
    setResult(r)
  }

  const limitReached = !isAuthenticated && !canCheck

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-3xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Vérificateur d'email</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Analyse multi-critères · Résultats en temps réel</p>
        </div>

        {limitReached ? (
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-2xl p-8 text-center">
            <p className="text-lg font-bold text-blue-900 dark:text-blue-300 mb-2">Vous avez utilisé vos 3 vérifications gratuites</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">Créez un compte gratuit pour accéder à 100 vérifications par mois avec tous les détails.</p>
            <Button size="lg" onClick={onRegister}>Créer un compte gratuit →</Button>
          </motion.div>
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
            <EmailVerifier
              onResult={handleResult}
              showFreeCounter={!isAuthenticated}
              checksUsed={checksUsed}
              checksRemaining={checksRemaining}
            />
          </div>
        )}

        {result && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
            <ResultCard result={result} onReset={() => setResult(null)} />
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}
