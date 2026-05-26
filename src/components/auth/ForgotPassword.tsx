import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import {
  AuthBrandHeader,
  LoadingSpinner,
} from './shared'
import {
  authInputStyle,
  authPageBackgroundStyle,
  handleAuthInputBlur,
  handleAuthInputFocus,
} from './styles'

type Props = {
  onNavigateLogin: () => void
}

export default function ForgotPassword({ onNavigateLogin }: Props) {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Please enter your email address')
      return
    }
    setError(null)
    setIsLoading(true)
    try {
      await apiFetch<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={authPageBackgroundStyle}
    >
      <div className="w-full max-w-[420px]">
        <AuthBrandHeader />

        <div
          className="backdrop-blur-xl border border-white/[0.06] rounded-3xl p-8"
          style={{ background: 'rgba(9,10,14,0.82)', boxShadow: '0 24px 80px -12px rgba(0,0,0,0.7)' }}
        >
          {sent ? (
            <div className="flex flex-col items-center text-center gap-4 py-2">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(201,122,75,0.15)', border: '1px solid rgba(201,122,75,0.25)' }}
              >
                <span className="material-symbols-outlined text-[#c97a4b]" style={{ fontSize: 28 }}>
                  mark_email_read
                </span>
              </div>
              <div>
                <h2 className="text-[1.05rem] font-semibold text-[#f3efe7] mb-2">Check your inbox</h2>
                <p className="text-[#8f877f] text-sm leading-relaxed">
                  If an account exists for <span className="text-[#c97a4b]">{email}</span>, you'll receive a
                  password reset link shortly.
                </p>
              </div>
              <p className="text-[#6b6560] text-xs mt-1">
                Didn't receive it? Check your spam folder or{' '}
                <button
                  onClick={() => { setSent(false); setEmail('') }}
                  className="text-[#c97a4b] hover:text-[#d4895c] transition-colors"
                >
                  try again
                </button>
                .
              </p>
              <button
                onClick={onNavigateLogin}
                className="w-full border border-white/[0.1] text-[#f3efe7] font-medium py-[11px] rounded-[42px] transition-colors text-sm hover:border-white/[0.18] mt-2"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-[1.05rem] font-semibold text-[#f3efe7] mb-1.5">Forgot your password?</h2>
                <p className="text-[#8f877f] text-sm leading-relaxed">
                  Enter your email address and we'll send you a link to reset your password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="forgot-email" className="block text-xs font-medium text-[#a9a39c] mb-1.5">
                    Email address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    className="w-full border rounded-xl px-4 py-[11px] text-[#f3efe7] text-sm placeholder:text-[#4a4440] outline-none transition-all"
                    style={authInputStyle}
                    onFocus={handleAuthInputFocus}
                    onBlur={handleAuthInputBlur}
                  />
                </div>

                {error && (
                  <div
                    className="px-4 py-2.5 rounded-xl border text-red-300 text-sm"
                    style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.18)' }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#c97a4b] hover:bg-[#d4895c] active:bg-[#b86d3e] text-[#100d0c] font-semibold py-[11px] rounded-[42px] transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <LoadingSpinner />
                      Sending…
                    </>
                  ) : (
                    'Send reset link'
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        {!sent && (
          <p className="text-center text-[#6b6560] text-sm mt-6">
            Remember your password?{' '}
            <button
              onClick={onNavigateLogin}
              className="text-[#c97a4b] hover:text-[#d4895c] transition-colors font-medium"
            >
              Back to sign in
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
