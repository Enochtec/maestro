import { useGoogleLogin } from '@react-oauth/google'
import type { AuthUser } from '../../contexts/AuthContext'
import { apiFetch } from '../../lib/api'
import maestroLogo from '../../maestro_logo.png'

export function AuthBrandHeader() {
  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      <img
        src={maestroLogo}
        alt="Maestro AI"
        className="w-12 h-12 rounded-xl object-contain relative top-[2px]"
      />
      <h1 className="text-[1.4rem] font-bold text-[#f3efe7] leading-none">Maestro AI</h1>
    </div>
  )
}

type GoogleAuthButtonProps = {
  disabled: boolean
  onStart: () => void
  onSuccess: (token: string, user: AuthUser) => void
  onError: (message: string) => void
}

export function GoogleAuthButton({ disabled, onStart, onSuccess, onError }: GoogleAuthButtonProps) {
  const googleLogin = useGoogleLogin({
    onSuccess: async ({ access_token }) => {
      onStart()
      try {
        const data = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: access_token }),
        })
        onSuccess(data.token, data.user)
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Google sign-in failed. Please try again.')
      }
    },
    onError: () => onError('Google sign-in was cancelled or failed. Please try again.'),
  })

  return (
    <button
      type="button"
      onClick={() => googleLogin()}
      disabled={disabled}
      className="w-full border border-white/[0.1] text-[#f3efe7] font-medium py-[11px] rounded-[42px] transition-colors text-sm flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed hover:border-white/[0.18]"
      style={{ background: 'rgba(255,255,255,0.05)' }}
    >
      <GoogleIcon />
      Continue with Google
    </button>
  )
}

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908C16.658 14.252 17.64 11.945 17.64 9.2z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}

export function LoadingSpinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
