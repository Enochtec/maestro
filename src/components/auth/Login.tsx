import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import type { AuthUser } from '../../contexts/AuthContext'
import { apiFetch } from '../../lib/api'
import {
  AuthBrandHeader,
  GoogleAuthButton,
  GoogleIcon,
  LoadingSpinner,
} from './shared'
import {
  authInputStyle,
  authPageBackgroundStyle,
  handleAuthInputBlur,
  handleAuthInputFocus,
} from './styles'

type Props = {
  onNavigateSignup: () => void
  onNavigateForgot: () => void
}

export default function Login({ onNavigateSignup, onNavigateForgot }: Props) {
  const auth = useAuth()
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Please fill in all fields')
      return
    }
    setError(null)
    setIsLoading(true)
    try {
      const data = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      auth.login(data.token, data.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 overflow-y-auto"
      style={authPageBackgroundStyle}
    >
      <div className="w-full max-w-[420px]">
        <AuthBrandHeader />

        <div
          className="backdrop-blur-xl border border-white/[0.06] rounded-3xl p-6 sm:p-8"
          style={{
            background: 'rgba(9,10,14,0.82)',
            boxShadow: '0 24px 80px -12px rgba(0,0,0,0.7)',
          }}
        >
          <h2 className="text-[1.05rem] font-semibold text-[#f3efe7] mb-6">Sign in to your account</h2>

          {googleClientId ? (
            <GoogleAuthButton
              disabled={isLoading}
              onStart={() => {
                setError(null)
                setIsLoading(true)
              }}
              onSuccess={(token, user) => {
                auth.login(token, user)
                setIsLoading(false)
              }}
              onError={(message) => {
                setError(message)
                setIsLoading(false)
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setError('Set VITE_GOOGLE_CLIENT_ID to enable Google sign-in.')}
              disabled={isLoading}
              className="w-full border border-white/[0.1] text-[#f3efe7] font-medium py-[11px] rounded-[42px] transition-colors text-sm flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed hover:border-white/[0.18]"
              style={{ background: 'rgba(255,255,255,0.05)' }}
            >
              <GoogleIcon />
              Continue with Google
            </button>
          )}

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 border-t border-white/[0.07]" />
            <span className="text-xs text-[#4a4440] font-medium select-none">or</span>
            <div className="flex-1 border-t border-white/[0.07]" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium text-[#a9a39c] mb-1.5">
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full border rounded-xl px-4 py-[11px] text-[#f3efe7] text-sm placeholder:text-[#4a4440] outline-none transition-all"
                style={authInputStyle}
                onFocus={handleAuthInputFocus}
                onBlur={handleAuthInputBlur}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="text-xs font-medium text-[#a9a39c]">
                  Password
                </label>
                <button
                  type="button"
                  onClick={onNavigateForgot}
                  className="text-xs text-[#2fbf71] hover:text-[#3ad784] transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full border rounded-xl px-4 py-[11px] pr-11 text-[#f3efe7] text-sm placeholder:text-[#4a4440] outline-none transition-all"
                  style={authInputStyle}
                  onFocus={handleAuthInputFocus}
                  onBlur={handleAuthInputBlur}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6560] hover:text-[#a9a39c] transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
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
              className="w-full bg-[#2fbf71] hover:bg-[#3ad784] active:bg-[#249d5d] text-[#100d0c] font-semibold py-[11px] rounded-[42px] transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-1"
            >
              {isLoading ? (
                <>
                  <LoadingSpinner />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[#6b6560] text-sm mt-6">
          Don't have an account?{' '}
          <button
            onClick={onNavigateSignup}
            className="text-[#2fbf71] hover:text-[#3ad784] transition-colors font-medium"
          >
            Create account
          </button>
        </p>
      </div>
    </div>
  )
}

