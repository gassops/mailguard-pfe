import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Shield, Server, Mail, Clock, Brain, Users, ArrowRight, Zap, Lock, BarChart3 } from 'lucide-react'
import type { VerificationResult } from '../types'
import { MODULE_CONFIG } from '../constants/modules'
import { useAuth } from '../context/AuthContext'
import EmailVerifier from '../components/verify/EmailVerifier'
import ResultCard from '../components/verify/ResultCard'
import Button from '../components/ui/Button'

const ICONS = { Shield, Server, Mail, Clock, Brain, Users }

const STEPS = [
  { icon: Mail, title: 'Soumettez une adresse email', desc: 'Aucun compte requis pour les 3 premiers contrôles. Entrez n\'importe quelle adresse email.' },
  { icon: Brain, title: '6 modules analysent en parallèle', desc: 'Blacklist, DNS, SMTP, âge du domaine, classificateur ML et signaux communautaires.' },
  { icon: Shield, title: 'Obtenez un score de confiance', desc: 'Un score de 0 à 100 avec un rapport détaillé complet en moins de 200ms.' },
]

const BENEFITS = [
  { icon: Zap, title: 'Résultats instantanés', desc: 'Analyse complète en moins de 200ms grâce à l\'exécution parallèle des 6 modules.' },
  { icon: Lock, title: 'Sécurisé par clé API', desc: 'Chaque client dispose de sa propre clé API unique générée à l\'inscription.' },
  { icon: BarChart3, title: 'Tableau de bord analytique', desc: 'Suivez vos vérifications, consultez vos statistiques et gérez votre intégration.' },
]

const stagger = { animate: { transition: { staggerChildren: 0.08 } } }
const fadeUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } }

const FREE_LIMIT = 3

export default function Home({ onRegister }: { onRegister?: () => void }) {
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [freeRemaining, setFreeRemaining] = useState(FREE_LIMIT)
  const { isAuthenticated, user } = useAuth()

  return (
    <motion.div initial="initial" animate="animate" className="dark:bg-gray-950">

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-950 via-blue-900 to-gray-900 px-4 py-24 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-600/20 via-transparent to-transparent pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <motion.div variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-300 bg-blue-500/10 border border-blue-500/30 px-3 py-1 rounded-full mb-6">
                <Shield size={11} /> Validation email multi-critères
              </span>
            </motion.div>
            <motion.h1 variants={fadeUp} className="text-4xl md:text-6xl font-extrabold text-white tracking-tight mb-5 leading-tight">
              Vérifiez n'importe quel email<br />
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">en quelques millisecondes</span>
            </motion.h1>
            <motion.p variants={fadeUp} className="text-lg text-blue-200 mb-10 max-w-xl mx-auto leading-relaxed">
              Une API REST qui analyse chaque adresse email avec 6 modules indépendants et retourne un score de confiance précis et expliqué.
            </motion.p>
            <motion.div variants={fadeUp} className="max-w-lg mx-auto">
              <EmailVerifier
                onResult={r => { setResult(r) }}
                showFreeCounter={!isAuthenticated}
                checksUsed={FREE_LIMIT - freeRemaining}
                checksRemaining={freeRemaining}
                disabled={!isAuthenticated && freeRemaining <= 0}
                onFreeRemainingChange={setFreeRemaining}
              />
            </motion.div>
            {isAuthenticated ? (
              <motion.p variants={fadeUp} className="text-xs text-blue-300 mt-3">
                Bienvenue, {user?.name?.split(' ')[0]} · Clé API active · Résultats en &lt; 200ms
              </motion.p>
            ) : (
              <motion.p variants={fadeUp} className="text-xs text-blue-400 mt-3">
                Sans compte · 3 vérifications gratuites · Résultats en &lt; 200ms
              </motion.p>
            )}
          </motion.div>
        </div>

        {result && (
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="relative max-w-3xl mx-auto mt-10 text-left">
            <ResultCard result={result} onReset={() => setResult(null)} />
          </motion.div>
        )}
      </section>

      {/* Benefits */}
      <section className="py-16 px-4 bg-white dark:bg-gray-900">
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {BENEFITS.map((b, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="flex items-start gap-4 p-5 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-xl flex items-center justify-center shrink-0">
                  <b.icon size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white text-sm mb-1">{b.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{b.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-4 bg-gray-50 dark:bg-gray-950" id="fonctionnalites">
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Comment ça fonctionne</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Trois étapes, une réponse claire</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((step, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12 }} className="text-center">
                <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/25">
                  <step.icon size={22} className="text-white" />
                </div>
                <span className="text-xs font-bold text-blue-500 dark:text-blue-400">Étape {i + 1}</span>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mt-1 mb-2">{step.title}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 6 Modules */}
      <section className="py-16 px-4 bg-white dark:bg-gray-900">
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-10">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">6 modules d'analyse</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Chaque module s'exécute indépendamment et contribue au score final avec un poids défini</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {MODULE_CONFIG.map((m, i) => {
              const IconComp = ICONS[m.icon as keyof typeof ICONS]
              return (
                <motion.div key={m.key} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07 }}
                  className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                      <IconComp size={18} className="text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{m.name}</p>
                      <p className="text-xs text-blue-500 dark:text-blue-400 font-medium">Poids : {(m.weight * 100).toFixed(0)}%</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{m.description}</p>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 bg-gradient-to-br from-blue-700 to-blue-900 text-white text-center">
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="max-w-lg mx-auto">
          {isAuthenticated ? (
            <>
              <h2 className="text-2xl font-bold mb-2">Votre espace est prêt</h2>
              <p className="text-blue-200 text-sm mb-8">Consultez votre tableau de bord pour voir votre quota, vos statistiques et intégrer l'API</p>
              <Link to="/dashboard">
                <Button variant="secondary" size="lg" icon={<ArrowRight size={18} />}>
                  Mon tableau de bord
                </Button>
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold mb-2">Commencez gratuitement</h2>
              <p className="text-blue-200 text-sm mb-8">100 vérifications par mois · Accès complet à l'API · Sans carte bancaire</p>
              <Button variant="secondary" size="lg" icon={<ArrowRight size={18} />} onClick={onRegister}>
                Obtenir ma clé API
              </Button>
            </>
          )}
        </motion.div>
      </section>
    </motion.div>
  )
}
