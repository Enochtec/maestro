/// <reference types="vite/client" />

interface Window {
	__deferredPrompt?: {
		prompt: () => Promise<void>
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
	} | null
	__installPromptReadyPromise?: Promise<void>
	__installPromptReadyResolve?: (() => void) | null
	triggerMaestroInstallPrompt?: () => Promise<boolean>
	requestMaestroInstallPrompt?: () => Promise<boolean>
}
