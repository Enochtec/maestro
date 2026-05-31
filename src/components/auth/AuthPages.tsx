import { useState } from 'react'
import Login from './Login'
import Signup from './Signup'
import ForgotPassword from './ForgotPassword'

type View = 'login' | 'signup' | 'forgot'

export default function AuthPages() {
  const [view, setView] = useState<View>('login')
  const installHelpText =
    'If your browser does not show Install, on iPhone tap Share, then Add to Home Screen. On Android, open the browser menu and choose Install app or Add to Home screen.'

  const handleInstall = async () => {
    const installed = await window.requestMaestroInstallPrompt?.()
    if (!installed) {
      window.alert(installHelpText)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-[420px]">
        <div
          className="mb-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 backdrop-blur-xl"
          style={{ boxShadow: '0 16px 48px -20px rgba(0,0,0,0.55)' }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#f3efe7]">Install the app on your phone</p>
              <p className="mt-1 text-xs leading-5 text-[#a9a39c]">{installHelpText}</p>
            </div>
            <button
              type="button"
              onClick={handleInstall}
              className="shrink-0 rounded-full bg-[#2fbf71] px-3 py-2 text-xs font-semibold text-[#100d0c] transition-colors hover:bg-[#3ad784]"
            >
              Install
            </button>
          </div>
        </div>

        {view === 'signup' ? (
          <Signup onNavigateLogin={() => setView('login')} />
        ) : view === 'forgot' ? (
          <ForgotPassword onNavigateLogin={() => setView('login')} />
        ) : (
          <Login onNavigateSignup={() => setView('signup')} onNavigateForgot={() => setView('forgot')} />
        )}
      </div>
    </div>
  )
}

