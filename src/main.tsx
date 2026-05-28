import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import './index.css'

const App = lazy(() => import('./App'))
const AuthPages = lazy(() => import('./components/auth/AuthPages'))

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
          <Suspense fallback={<div />}> 
            <Root />
          </Suspense>
        </AuthProvider>
      </GoogleOAuthProvider>
    ) : (
      <AuthProvider>
        <Suspense fallback={<div />}>
          <Root />
        </Suspense>
      </AuthProvider>
    )}
  </StrictMode>,
)

// Register service worker for PWA (if supported) and notify on updates
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        // show update UI when there's an already-waiting SW
        const promptUserToRefresh = (reg: ServiceWorkerRegistration) => {
          // Only show on small screens (phones)
          const isPhone = window.innerWidth <= 480
          if (!isPhone) return
          // create a simple compact banner element if not present
          if (document.getElementById('sw-update-notice')) return
          const el = document.createElement('div')
          el.id = 'sw-update-notice'
          el.style.cssText = 'position:fixed;left:10px;right:10px;bottom:12px;padding:8px 10px;background:#2b2b2b;color:#fff;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,0.45);display:flex;gap:8px;align-items:center;z-index:10000;font-size:13px;'
          el.innerHTML = `
            <div style="flex:1;font-weight:600">New version available</div>
            <button id="sw-refresh-btn" style="background:#2fbf71;border:none;padding:6px 8px;border-radius:8px;color:#000;cursor:pointer;font-weight:700;font-size:12px">Refresh</button>
            <button id="sw-dismiss-btn" style="background:transparent;border:1px solid rgba(255,255,255,0.06);padding:6px 8px;border-radius:8px;color:#fff;cursor:pointer;font-size:12px">Dismiss</button>
          `
          document.body.appendChild(el)

          const refresh = async () => {
            if (!reg.waiting) return
            reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          }

          document.getElementById('sw-refresh-btn')?.addEventListener('click', refresh)
          document.getElementById('sw-dismiss-btn')?.addEventListener('click', () => el.remove())
        }

        if (registration.waiting) {
          promptUserToRefresh(registration)
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              promptUserToRefresh(registration)
            }
          })
        })

        // when the new service worker has taken control, reload to load the new content
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload()
        })
      })
      .catch(() => {
        // ignore registration errors
      })
  })
}

// Capture beforeinstallprompt so we can trigger the install prompt later from settings
window.addEventListener('beforeinstallprompt', (e: any) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault()
  // Store the event for later use
  // @ts-ignore
  window.__deferredPrompt = e

  try {
    const shown = localStorage.getItem('maestro_install_shown')
    const isPhone = window.innerWidth <= 480
    if (!shown && isPhone) {
      // show a compact install banner on first visit
      if (!document.getElementById('sw-install-notice')) {
        const el = document.createElement('div')
        el.id = 'sw-install-notice'
        el.style.cssText = 'position:fixed;left:10px;right:10px;top:12px;padding:8px 10px;background:#1f1f1f;color:#fff;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,0.45);display:flex;gap:8px;align-items:center;z-index:10000;font-size:13px;'
        el.innerHTML = `
          <div style="flex:1;font-weight:600">Install Maestro for quick access</div>
          <button id="sw-install-btn" style="background:#2fbf71;border:none;padding:6px 8px;border-radius:8px;color:#000;cursor:pointer;font-weight:700;font-size:12px">Install</button>
          <button id="sw-install-dismiss" style="background:transparent;border:1px solid rgba(255,255,255,0.06);padding:6px 8px;border-radius:8px;color:#fff;cursor:pointer;font-size:12px">Dismiss</button>
        `
        document.body.appendChild(el)

        document.getElementById('sw-install-dismiss')?.addEventListener('click', () => {
          el.remove()
          localStorage.setItem('maestro_install_shown', '1')
        })

        document.getElementById('sw-install-btn')?.addEventListener('click', async () => {
          const installed = await window.triggerMaestroInstallPrompt?.()
          if (installed) {
            el.remove()
            localStorage.setItem('maestro_install_shown', '1')
          }
        })
      }
    }
  } catch (err) {
    void err
  }
})

window.triggerMaestroInstallPrompt = async () => {
  // @ts-ignore
  const prompt = window.__deferredPrompt
  if (!prompt) return false
  try {
    await prompt.prompt()
    await prompt.userChoice
    localStorage.setItem('maestro_install_shown', '1')
    // @ts-ignore
    window.__deferredPrompt = null
    return true
  } catch (err) {
    void err
    return false
  }
}

