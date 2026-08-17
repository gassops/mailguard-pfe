import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'react-hot-toast'
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import Button from '../ui/Button'
import Input from '../ui/Input'

const schema = z.object({
  email: z.string().email('Email valide requis'),
  password: z.string().min(1, 'Mot de passe requis'),
})
type FormData = z.infer<typeof schema>

interface Props { isOpen: boolean; onClose: () => void; onSwitchToRegister: () => void }

export default function LoginModal({ isOpen, onClose, onSwitchToRegister }: Props) {
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setLoading(true)
    try {
      await login(data)
      toast.success('Connexion réussie !')
      reset()
      onClose()
    } catch {
      toast.error('Email ou mot de passe incorrect')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
            className="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-8 z-10"
          >
            <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition">
              <X size={20} />
            </button>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Connexion</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Accédez à votre tableau de bord</p>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input {...register('email')} type="email" label="Adresse email" placeholder="vous@exemple.com" error={errors.email?.message} />
              <Input {...register('password')} type="password" label="Mot de passe" placeholder="••••••••" error={errors.password?.message} />
              <Button type="submit" loading={loading} className="w-full" size="lg">Se connecter</Button>
            </form>
            <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
              Pas encore de compte ?{' '}
              <button onClick={onSwitchToRegister} className="text-blue-600 font-medium hover:underline">Créer un compte gratuit</button>
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
