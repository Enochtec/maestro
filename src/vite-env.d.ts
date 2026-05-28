/// <reference types="vite/client" />

interface Window {
	__deferredPrompt?: {
		prompt: () => Promise<void>
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
	} | null
	triggerMaestroInstallPrompt?: () => Promise<boolean>
}
