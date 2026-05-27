import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

export type AuthUser = {
  id: number
  name: string
  email: string
  avatarUrl?: string | null
}

type AuthContextType = {
  user: AuthUser | null
  token: string | null
  login: (token: string, user: AuthUser) => void
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

function readStoredAuth() {
  if (typeof window === 'undefined') {
    return { user: null, token: null }
  }

  const savedToken = localStorage.getItem('maestro_token')
  const savedUser = localStorage.getItem('maestro_user')

  if (savedToken && savedUser) {
    try {
      return {
        token: savedToken,
        user: JSON.parse(savedUser) as AuthUser,
      }
    } catch {
      localStorage.removeItem('maestro_token')
      localStorage.removeItem('maestro_user')
    }
  }

  return { user: null, token: null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialAuth = readStoredAuth()
  const [user, setUser] = useState<AuthUser | null>(initialAuth.user)
  const [token, setToken] = useState<string | null>(initialAuth.token)
  const [isLoading] = useState(false)

  const login = (newToken: string, newUser: AuthUser) => {
    setToken(newToken)
    setUser(newUser)
    localStorage.setItem('maestro_token', newToken)
    localStorage.setItem('maestro_user', JSON.stringify(newUser))
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('maestro_token')
    localStorage.removeItem('maestro_user')
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

