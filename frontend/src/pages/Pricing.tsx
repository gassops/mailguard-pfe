import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import Button from '../components/ui/Button'

const PLANS = [
  {
    name: 'Gratuit', price: '0€', period: '/mois', highlight: false,
    badge: null,
    features: ['100 vérifications/mois', '3 vérifications/jour sans compte', 'Résultats de base', 'Modules MX + Blacklist', 'Support communautaire'],
    cta: 'Commencer gratuitement', ctaVariant: 'outline' as const,
  },
  {
    name: 'Pro', price: '19€', period: '/mois', highlight: true,
    badge: 'Le plus populaire',
    features: ['10 000 vérifications/mois', 'Les 6 modules (dont ML)', 'Détails complets par module', 'Notifications webhook', 'Tableau de bord + statistiques', 'Support email · P95 < 200ms'],
    cta: 'Essai gratuit 14 jours', ctaVariant: 'secondary' as const,
  },
  {
    name: 'Entreprise', price: 'Sur devis', period: '', highlight: false,
    badge: null,
    features: ['Vérifications illimitées', 'Limites de débit personnalisées', 'Infrastructure dédiée', 'Garantie SLA', 'Support prioritaire', 'Accompagnement & intégration'],
    cta: 'Nous contacter', ctaVariant: 'outline' as const,
  },
]

const FAQS = [
  { q: 'Le plan gratuit est-il vraiment gratuit ?', a: 'Oui, pour toujours. 100 vérifications par mois sans carte bancaire requise.' },
  { q: 'Comment est calculé le score de confiance ?', a: 'C\'est une somme pondérée de 6 scores de modules : blacklist (40%), MX (15%), SMTP (15%), âge du domaine (10%), classificateur ML (15%), crowdsource (5%).' },
  { q: 'Que se passe-t-il si je dépasse ma limite mensuelle ?', a: 'L\'API retourne une erreur 429. Passez au plan Pro pour plus de capacité ou attendez la réinitialisation mensuelle.' },
  { q: 'Puis-je utiliser MailGuard sans créer un compte ?', a: 'Oui — la page Vérifier permet 3 vérifications gratuites toutes les 24h sans inscription.' },
  { q: 'Mes données sont-elles stockées ?', a: 'Les résultats sont mis en cache dans Redis pendant 1 heure pour améliorer les performances. Aucune donnée personnelle n\'est stockée de façon permanente.' },
]

export default function Pricing({ onRegister }: { onRegister?: () => void }) {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="min-h-screen bg-gray-50 dark:bg-gray-950 py-16">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">Tarifs simples et transparents</h1>
          <p className="text-gray-500 dark:text-gray-400">Commencez gratuitement, évoluez selon vos besoins</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16 items-start">
          {PLANS.map((plan, i) => (
            <motion.div key={plan.name} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
              className={`rounded-2xl border-2 p-6 transition-transform ${
                plan.highlight
                  ? 'border-blue-500 bg-blue-600 md:scale-105 shadow-xl shadow-blue-500/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm'
              }`}
            >
              {plan.badge && <p className="text-xs font-bold text-blue-200 uppercase tracking-wider mb-3">{plan.badge}</p>}
              <h2 className={`text-xl font-bold mb-1 ${plan.highlight ? 'text-white' : 'text-gray-900 dark:text-white'}`}>{plan.name}</h2>
              <p className={`text-3xl font-extrabold mb-1 ${plan.highlight ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
                {plan.price}
                <span className={`text-sm font-normal ${plan.highlight ? 'text-blue-200' : 'text-gray-400'}`}>{plan.period}</span>
              </p>
              <ul className="space-y-2.5 my-6">
                {plan.features.map(f => (
                  <li key={f} className={`flex items-start gap-2 text-sm ${plan.highlight ? 'text-blue-100' : 'text-gray-600 dark:text-gray-300'}`}>
                    <Check size={14} className={`mt-0.5 shrink-0 ${plan.highlight ? 'text-blue-200' : 'text-blue-600'}`} />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={plan.highlight ? 'secondary' : plan.ctaVariant}
                className="w-full"
                onClick={i < 2 ? onRegister : undefined}
              >{plan.cta}</Button>
            </motion.div>
          ))}
        </div>

        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-6">Questions fréquentes</h2>
          <div className="space-y-2">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  {faq.q}
                  <motion.span animate={{ rotate: openFaq === i ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronDown size={16} className="text-gray-400 shrink-0" />
                  </motion.span>
                </button>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      <p className="px-5 pb-4 text-sm text-gray-500 dark:text-gray-400">{faq.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
