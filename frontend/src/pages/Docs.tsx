import { motion } from 'framer-motion'
import { Shield, Key, Zap, AlertTriangle, CheckCircle, Code } from 'lucide-react'
import CodeSnippet from '../components/ui/CodeSnippet'

const SECTIONS = [
  {
    id: 'introduction',
    icon: Shield,
    title: 'Introduction',
    content: `MailGuard est une API REST de validation d'adresses email. Elle analyse chaque adresse selon 6 critères indépendants et retourne un score de confiance de 0 à 100 accompagné d'un verdict : VALID, SUSPICIOUS ou INVALID.`
  },
  {
    id: 'authentification',
    icon: Key,
    title: 'Authentification',
    content: `Toutes les requêtes (sauf /health) nécessitent une clé API passée dans le header HTTP X-API-Key. Obtenez votre clé en créant un compte gratuit.`
  },
  {
    id: 'score',
    icon: Zap,
    title: 'Comprendre le score',
    content: `Le score final est une somme pondérée des 6 modules :\n\n• Blacklist (40%) — domaine dans une liste de jetables ?\n• MX Record (15%) — le domaine peut-il recevoir des emails ?\n• SMTP (15%) — la boîte mail existe-t-elle vraiment ?\n• Âge du domaine (10%) — domaine récemment créé ?\n• ML Classifier (15%) — probabilité de domaine suspect ?\n• Crowdsource (5%) — signalé par la communauté ?\n\nSeuils : score ≤ 20 → VALID · 21–50 → SUSPICIOUS · ≥ 51 → INVALID`
  },
  {
    id: 'erreurs',
    icon: AlertTriangle,
    title: 'Codes d\'erreur',
    content: `400 — Requête invalide (email manquant ou mal formaté)\n401 — Clé API manquante ou invalide\n409 — Conflit (ex: email déjà signalé par ce client)\n429 — Limite de débit atteinte (attendre 60 secondes)\n500 — Erreur interne du serveur`
  },
  {
    id: 'bonnes-pratiques',
    icon: CheckCircle,
    title: 'Bonnes pratiques',
    content: `• Utilisez /verify/bulk pour analyser plusieurs emails en un seul appel (max 50)\n• Les résultats sont mis en cache 1 heure — profitez-en pour les emails fréquents\n• En cas de score SUSPICIOUS, combinez avec d'autres signaux métier avant de rejeter\n• Configurez un webhook pour être notifié en temps réel des résultats INVALID`
  },
]

const EXAMPLES = [
  {
    title: 'Vérifier un email',
    code: `curl -X POST http://localhost:8080/api/v1/verify \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: mg_votre_cle" \\
  -d '{"email": "utilisateur@gmail.com"}'`
  },
  {
    title: 'Vérification en masse (jusqu\'à 50 emails)',
    code: `curl -X POST http://localhost:8080/api/v1/verify/bulk \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: mg_votre_cle" \\
  -d '{"emails": ["a@gmail.com", "b@mailinator.com"]}'`
  },
  {
    title: 'Consulter vos statistiques',
    code: `curl http://localhost:8080/api/v1/stats?periode=30 \\
  -H "X-API-Key: mg_votre_cle"`
  },
  {
    title: 'Configurer un webhook',
    code: `curl -X POST http://localhost:8080/api/v1/webhook \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: mg_votre_cle" \\
  -d '{"url": "https://votre-site.com/hook", "events": ["INVALID"]}'`
  },
]

export default function Docs() {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-5xl mx-auto px-4 py-12 flex gap-8">

        {/* Sidebar */}
        <aside className="hidden lg:block w-52 shrink-0">
          <div className="sticky top-24 space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Documentation</p>
            {SECTIONS.map(s => (
              <a key={s.id} href={`#${s.id}`} className="block px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition">
                {s.title}
              </a>
            ))}
            <a href="#exemples" className="block px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition">
              Exemples
            </a>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 space-y-10">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Documentation</h1>
            <p className="text-gray-500 dark:text-gray-400">Guide complet pour intégrer et utiliser l'API MailGuard</p>
          </div>

          {SECTIONS.map(s => (
            <section key={s.id} id={s.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                  <s.icon size={16} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{s.title}</h2>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">{s.content}</p>
            </section>
          ))}

          {/* Exemples */}
          <section id="exemples">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                <Code size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Exemples de requêtes</h2>
            </div>
            <div className="space-y-4">
              {EXAMPLES.map((ex, i) => (
                <div key={i}>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{ex.title}</p>
                  <CodeSnippet code={ex.code} />
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </motion.div>
  )
}
