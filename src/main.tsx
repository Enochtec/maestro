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

let resolveInstallPromptReady: (() => void) | null = null
window.__installPromptReadyPromise = new Promise<void>((resolve) => {
  resolveInstallPromptReady = resolve
})
window.__installPromptReadyResolve = resolveInstallPromptReady

// Capture beforeinstallprompt so we can trigger the install prompt later from settings
window.addEventListener('beforeinstallprompt', (e: any) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault()
  // Store the event for later use
  // @ts-ignore
  window.__deferredPrompt = e
  window.__installPromptReadyResolve?.()
  window.__installPromptReadyResolve = null

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
          const installed = await window.requestMaestroInstallPrompt?.()
          if (installed) {
            el.remove()
            localStorage.setItem('maestro_install_shown', '1')
          } else {
            window.alert('Install is not available in this browser right now.')
          }
        })
      }
    }
  } catch (err) {
    void err
  }
})

// --- Installability debug helpers ---------------------------------------
async function fetchManifest() {
  try {
    const res = await fetch('/manifest.webmanifest', { cache: 'no-store' })
    if (!res.ok) return { ok: false, status: res.status }
    const json = await res.json()
    return { ok: true, json }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function renderInstallDebug() {
  try {
    const containerId = 'maestro-install-debug'
    let el = document.getElementById(containerId)
    if (!el) {
      el = document.createElement('div')
      el.id = containerId
      el.style.cssText = 'position:fixed;left:12px;bottom:80px;padding:8px 10px;background:rgba(0,0,0,0.7);color:#fff;border-radius:8px;z-index:10000;font-size:12px;max-width:320px;'
      document.body.appendChild(el)
    }

    const manifest = await fetchManifest()
    const swSupported = 'serviceWorker' in navigator
    const swController = !!(navigator.serviceWorker && navigator.serviceWorker.controller)
    const deferred = Boolean((window as any).__deferredPrompt)

    el.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">Installability Debug</div>
      <div>Service worker: ${swSupported ? 'supported' : 'not supported'}</div>
      <div>SW controlling page: ${swController}</div>
      <div>Deferred prompt captured: ${deferred}</div>
      <div style="margin-top:6px;font-weight:600">Manifest</div>
      <pre style="white-space:pre-wrap;max-height:160px;overflow:auto;margin:6px 0;padding:6px;background:rgba(255,255,255,0.02);border-radius:6px">${manifest.ok ? JSON.stringify(manifest.json, null, 2) : 'failed: ' + (manifest.status ?? manifest.error)}</pre>
      <div style="margin-top:6px;font-size:11px;opacity:0.9">Reload the page after granting the install banner on the device to update these values.</div>
      <div style="margin-top:8px"><button id="maestro-debug-install" style="background:#2fbf71;border:none;padding:6px 8px;border-radius:6px;color:#000;font-weight:700;cursor:pointer">Trigger install prompt (debug)</button></div>
    `
    // attach click handler for debug button
    const btn = document.getElementById('maestro-debug-install')
    if (btn) {
      btn.addEventListener('click', async () => {
        const res = await window.requestMaestroInstallPrompt?.()
        if (!res) window.alert('Install was not accepted or not available')
      })
    }
  } catch (err) {
    console.error('install debug render failed', err)
  }
}

// initial render
renderInstallDebug()

// refresh on SW controllerchange or when the deferred prompt becomes available
navigator.serviceWorker?.addEventListener?.('controllerchange', () => renderInstallDebug())
window.addEventListener('beforeinstallprompt', () => {
  console.log('[Maestro] beforeinstallprompt fired; deferred prompt saved')
  renderInstallDebug()
})
window.addEventListener('appinstalled', () => {
  console.log('[Maestro] appinstalled event - app was installed')
  renderInstallDebug()
})

window.addEventListener('appinstalled', () => {
  localStorage.setItem('maestro_install_shown', '1')
  // @ts-ignore
  window.__deferredPrompt = null
})

window.requestMaestroInstallPrompt = async () => {
  // @ts-ignore
  const prompt = window.__deferredPrompt
  if (!prompt) return false
  try {
    prompt.prompt()
    const choice = await prompt.userChoice
    // show a brief on-page toast with the result so users see what happened
    try {
      let toast = document.getElementById('maestro-install-result')
      if (!toast) {
        toast = document.createElement('div')
        toast.id = 'maestro-install-result'
        toast.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:24px;padding:8px 12px;background:#111;color:#fff;border-radius:8px;z-index:10001;font-weight:600'
        document.body.appendChild(toast)
      }
      toast.textContent = `Install ${choice.outcome}`
      setTimeout(() => toast?.remove(), 4000)
    } catch {
      // ignore DOM errors
    }
    localStorage.setItem('maestro_install_shown', '1')
    // @ts-ignore
    window.__deferredPrompt = null
    return choice.outcome === 'accepted'
  } catch (err) {
    void err
    return false
  }
}

window.triggerMaestroInstallPrompt = window.requestMaestroInstallPrompt

