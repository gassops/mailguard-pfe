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
  name: z.string().min(2, 'Nom requis (2 caractères minimum)'),
  email: z.string().email('Email valide requis'),
  password: z.string().min(8, 'Minimum 8 caractères'),
})
type FormData = z.infer<typeof schema>

interface Props { isOpen: boolean; onClose: () => void; onSwitchToLogin: () => void; onSuccess: (apiKey: string) => void }

export default function RegisterModal({ isOpen, onClose, onSwitchToLogin, onSuccess }: Props) {
  const { register: authRegister } = useAuth()
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setLoading(true)
    try {
      const apiKey = await authRegister(data)
      reset()
      onClose()
      onSuccess(apiKey)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erreur lors de l\'inscription')
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
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Créer un compte</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Obtenez votre clé API instantanément — gratuit pour toujours</p>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input {...register('name')} label="Nom / Société" placeholder="Votre nom" error={errors.name?.message} />
              <Input {...register('email')} type="email" label="Adresse email" placeholder="vous@exemple.com" error={errors.email?.message} />
              <Input {...register('password')} type="password" label="Mot de passe" placeholder="8 caractères minimum" error={errors.password?.message} />
              <Button type="submit" loading={loading} className="w-full" size="lg">Créer mon compte</Button>
            </form>
            <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
              Déjà un compte ?{' '}
              <button onClick={onSwitchToLogin} className="text-blue-600 font-medium hover:underline">Se connecter</button>
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
