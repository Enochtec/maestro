import type { CSSProperties, FocusEvent } from 'react'

export const authPageBackgroundStyle: CSSProperties = {
  background: 'radial-gradient(ellipse at 50% 40%, rgba(47,191,113,0.08) 0%, transparent 60%), #08090d',
}

export const authInputStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  borderColor: 'rgba(255,255,255,0.08)',
}

export function handleAuthInputFocus(e: FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = 'rgba(47,191,113,0.5)'
  e.target.style.background = 'rgba(255,255,255,0.07)'
  e.target.style.boxShadow = '0 0 0 3px rgba(47,191,113,0.1)'
}

export function handleAuthInputBlur(e: FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = 'rgba(255,255,255,0.08)'
  e.target.style.background = 'rgba(255,255,255,0.05)'
  e.target.style.boxShadow = 'none'
}

