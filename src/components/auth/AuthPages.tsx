import { useState } from 'react'
import Login from './Login'
import Signup from './Signup'
import ForgotPassword from './ForgotPassword'

type View = 'login' | 'signup' | 'forgot'

export default function AuthPages() {
  const [view, setView] = useState<View>('login')

  if (view === 'signup') {
    return <Signup onNavigateLogin={() => setView('login')} />
  }

  if (view === 'forgot') {
    return <ForgotPassword onNavigateLogin={() => setView('login')} />
  }

  return (
    <Login
      onNavigateSignup={() => setView('signup')}
      onNavigateForgot={() => setView('forgot')}
    />
  )
}

