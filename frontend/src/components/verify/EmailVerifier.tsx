import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useState } from 'react'
import type { VerificationResult } from '../../types'
import { verifyEmail, FreeQuotaExceededError } from '../../services/api'
import Button from '../ui/Button'
import Input from '../ui/Input'

const schema = z.object({ email: z.string().email('Veuillez entrer une adresse email valide') })
type FormData = z.infer<typeof schema>

interface Props {
  onResult: (r: VerificationResult) => void
  showFreeCounter?: boolean
  checksUsed?: number
  checksRemaining?: number
  disabled?: boolean
  /** Appelé après une vérification gratuite réussie avec le quota restant réel (backend) */
  onFreeRemainingChange?: (remaining: number) => void
}

export default function EmailVerifier({ onResult, showFreeCounter, checksUsed = 0, checksRemaining = 3, disabled, onFreeRemainingChange }: Props) {
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit({ email }: FormData) {
    setLoading(true)
    try {
      const result = await verifyEmail(email)
      onResult(result)
      if (typeof result.freeRemaining === 'number' && !Number.isNaN(result.freeRemaining)) {
        onFreeRemainingChange?.(result.freeRemaining)
      }
    } catch (err) {
      if (err instanceof FreeQuotaExceededError) {
        onFreeRemainingChange?.(0)
        toast.error('Quota gratuit épuisé — créez un compte pour continuer')
      } else {
        toast.error('Analyse échouée — veuillez réessayer')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit(onSubmit)} className="flex gap-2">
        <Input
          {...register('email')}
          type="email"
          placeholder="exemple@domaine.com"
          icon={<Mail size={16} />}
          error={errors.email?.message}
          disabled={disabled || loading}
        />
        <Button type="submit" loading={loading} disabled={disabled} size="lg" className="shrink-0">
          Analyser
        </Button>
      </form>
      {showFreeCounter && (
        <p className="text-xs text-gray-400 mt-2 text-center">
          {checksUsed === 0
            ? `${checksRemaining} vérifications gratuites disponibles · Sans compte`
            : `${checksRemaining} vérification${checksRemaining !== 1 ? 's' : ''} gratuite${checksRemaining !== 1 ? 's' : ''} restante${checksRemaining !== 1 ? 's' : ''} sur 3`
          }
        </p>
      )}
    </div>
  )
}
