import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import './index.css'
import App from './App.tsx'
import AuthPages from './components/auth/AuthPages'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

function Root() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: '#08090d' }}
      />
    )
  }

  return user ? <App /> : <AuthPages />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {googleClientId ? (
      <GoogleOAuthProvider clientId={googleClientId}>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </GoogleOAuthProvider>
    ) : (
      <AuthProvider>
        <Root />
      </AuthProvider>
    )}
  </StrictMode>,
)

