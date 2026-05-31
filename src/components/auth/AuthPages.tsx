import { useState } from 'react'
import Login from './Login'
import Signup from './Signup'
import ForgotPassword from './ForgotPassword'

type View = 'login' | 'signup' | 'forgot'

export default function AuthPages() {
  const [view, setView] = useState<View>('login')

  return (
    <div className="min-h-screen flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-[420px]">
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

