import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env.local' })
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const schemaPath = path.join(rootDir, 'db', 'schema.sql')

const app = express()
const requestedPort = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'
const JWT_SECRET = process.env.JWT_SECRET ?? 'maestro-dev-secret-please-change-in-production'
const BCRYPT_ROUNDS = 10

let pool
let httpServer

function buildPoolConfig() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Set it to your Neon connection string in .env.local')
  }

  return {
    connectionString: databaseUrl,
  }
}

function requireStrings(obj, ...keys) {
  for (const key of keys) {
    if (typeof obj[key] !== 'string' || !obj[key].trim()) return key
  }
  return null
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET)
    req.userId = payload.userId
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

app.use(cors())
app.use(express.json({ limit: '20mb' }))

async function ensureDatabase() {
  // Neon is PostgreSQL-compatible, so we connect directly via DATABASE_URL
  // and run schema migrations against that database.
  pool = new Pool(buildPoolConfig())


  try {
    // quick probe to validate connection
    await pool.query('SELECT 1')
  } catch (err) {
    console.error('[Maestro] Database connection failed:', err)
    throw err
  }

  console.log('[Maestro] Running schema migrations…')
  const schema = await fs.readFile(schemaPath, 'utf8')
  try {
    await pool.query(schema)
    console.log('[Maestro] Schema ready.')
  } catch (err) {
    // On cPanel/shared hosting it's common not to have permissions
    // to run migrations programmatically. Log a warning but allow
    // the server to start so static assets and non-DB routes remain available.
    console.warn('[Maestro] Schema migration failed (continuing):', err.message || err)
  }

}

// ── Auth endpoints ────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const body = req.body ?? {}
  const missing = requireStrings(body, 'name', 'email', 'password')
  if (missing) {
    return res.status(400).json({ error: 'Name, email and password are required' })
  }
  const { name, email, password } = body
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, avatar_url',
      [name.trim(), email.toLowerCase(), hash],
    )
    const user = rows[0]
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' })
    return res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url ?? null },
    })
  } catch (err) {
    console.error('[Maestro] Register error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const body = req.body ?? {}
  const missing = requireStrings(body, 'email', 'password')
  if (missing) {
    return res.status(400).json({ error: 'Email and password are required' })
  }
  const { email, password } = body
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash, avatar_url FROM users WHERE email = $1',
      [email.toLowerCase()],
    )
    const user = rows[0]
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' })
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' })
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url ?? null },
    })
  } catch (err) {
    console.error('[Maestro] Login error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Login failed' })
  }
})

app.post('/api/auth/google', async (req, res) => {
  const { accessToken } = req.body ?? {}
  if (typeof accessToken !== 'string' || !accessToken) {
    return res.status(400).json({ error: 'Google access token is required' })
  }
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!profileRes.ok) return res.status(401).json({ error: 'Invalid Google access token' })
    const profile = await profileRes.json()
    const { email, sub: googleId, name, picture, email_verified } = profile
    if (!email_verified) return res.status(401).json({ error: 'Google email is not verified' })

    const { rows } = await pool.query(
      'SELECT id, name, email, avatar_url FROM users WHERE google_id = $1 OR email = $2',
      [googleId, email.toLowerCase()],
    )
    let user = rows[0]
    if (!user) {
      const insert = await pool.query(
        'INSERT INTO users (name, email, google_id, avatar_url) VALUES ($1, $2, $3, $4) RETURNING id, name, email, avatar_url',
        [name, email.toLowerCase(), googleId, picture],
      )
      user = insert.rows[0]
    } else {
      await pool.query('UPDATE users SET google_id = $1, avatar_url = $2 WHERE id = $3', [googleId, picture, user.id])
      user.avatar_url = picture
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' })
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url ?? null },
    })
  } catch (err) {
    console.error('[Maestro] Google auth error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Google auth failed' })
  }
})

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Email is required' })
  }
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (rows[0]) {
      const resetToken = jwt.sign({ userId: rows[0].id, type: 'reset' }, JWT_SECRET, { expiresIn: '1h' })
      console.log(`[Maestro] Password reset token for ${email}: ${resetToken}`)
    }
    return res.json({ message: 'If an account with that email exists, a password reset link has been sent.' })
  } catch (err) {
    console.error('[Maestro] Forgot-password error:', err)
    return res.status(500).json({ error: 'Failed to process request' })
  }
})

app.get('/api/auth/me', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' })
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET)
    const { rows } = await pool.query(
      'SELECT id, name, email, avatar_url FROM users WHERE id = $1',
      [payload.userId],
    )
    if (!rows[0]) return res.status(401).json({ error: 'User not found' })
    const u = rows[0]
    return res.json({ user: { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url ?? null } })
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
})

// ── Thread endpoints ──────────────────────────────────────────────────────────

app.get('/api/threads', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title FROM threads WHERE user_id = $1 ORDER BY updated_at DESC, id DESC',
      [req.userId],
    )
    res.json({ threads: rows })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read threads' })
  }
})

app.post('/api/threads', requireAuth, async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'New chat'
    const { rows } = await pool.query(
      'INSERT INTO threads (user_id, title) VALUES ($1, $2) RETURNING id, title',
      [req.userId, title],
    )
    res.status(201).json(rows[0])
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create thread' })
  }
})

app.patch('/api/threads/:threadId', requireAuth, async (req, res) => {
  try {
    const threadId = Number(req.params.threadId)
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    if (!Number.isFinite(threadId)) return res.status(400).json({ error: 'Invalid thread id' })
    if (!title) return res.status(400).json({ error: 'Title is required' })
    const { rows } = await pool.query(
      'UPDATE threads SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING id, title',
      [title, threadId, req.userId],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Thread not found' })
    res.json(rows[0])
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update thread' })
  }
})

app.get('/api/threads/:threadId/messages', requireAuth, async (req, res) => {
  try {
    const threadId = Number(req.params.threadId)
    if (!Number.isFinite(threadId)) return res.status(400).json({ error: 'Invalid thread id' })
    const owns = await pool.query('SELECT id FROM threads WHERE id = $1 AND user_id = $2', [threadId, req.userId])
    if (!owns.rows[0]) return res.status(404).json({ error: 'Thread not found' })
    const { rows } = await pool.query(
      'SELECT id, role, content, pending, created_at FROM messages WHERE thread_id = $1 ORDER BY created_at ASC, id ASC',
      [threadId],
    )
    res.json({ messages: rows })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read messages' })
  }
})

app.post('/api/threads/:threadId/messages', requireAuth, async (req, res) => {
  try {
    const threadId = Number(req.params.threadId)
    const role = req.body?.role
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    const pending = Boolean(req.body?.pending)
    if (!Number.isFinite(threadId)) return res.status(400).json({ error: 'Invalid thread id' })
    if (role !== 'user' && role !== 'assistant') return res.status(400).json({ error: 'Invalid role' })
    if (!content.trim()) return res.status(400).json({ error: 'Content is required' })
    const owns = await pool.query('SELECT id FROM threads WHERE id = $1 AND user_id = $2', [threadId, req.userId])
    if (!owns.rows[0]) return res.status(404).json({ error: 'Thread not found' })
    await pool.query('UPDATE threads SET updated_at = NOW() WHERE id = $1', [threadId])
    const { rows } = await pool.query(
      'INSERT INTO messages (thread_id, role, content, pending) VALUES ($1, $2, $3, $4) RETURNING id, role, content, pending, created_at',
      [threadId, role, content, pending],
    )
    res.status(201).json(rows[0])
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save message' })
  }
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ── AI chat endpoint (DeepSeek) ─────────────────────────────────────────────

app.post('/api/chat', requireAuth, async (req, res) => {
  const { messages } = req.body ?? {}

  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY ?? process.env.VITE_DEEPSEEK_API_KEY
  const deepSeekModel = process.env.DEEPSEEK_MODEL ?? process.env.VITE_DEEPSEEK_MODEL ?? 'deepseek-chat'
  if (!deepSeekApiKey) {
    return res.status(500).json({
      error: 'Missing DEEPSEEK_API_KEY (or VITE_DEEPSEEK_API_KEY) in .env.local',
    })
  }

  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' })
  }

  const systemText =
    'You are Maestro, a concise, polished AI assistant. Be helpful, direct, and practical. ' +
    'If asked who built you (or similar questions), reply that you were built by a student from the University of Eldoret named Enock Juma.'

  try {
    const deepSeekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepSeekApiKey}`,
      },
      body: JSON.stringify({
        model: deepSeekModel,
        stream: true,
        messages: [
          { role: 'system', content: systemText },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
      }),
    })

    if (!deepSeekRes.ok) {
      const errText = await deepSeekRes.text()
      return res.status(deepSeekRes.status).json({ error: errText || 'DeepSeek request failed' })
    }

    if (!deepSeekRes.body) {
      const body = await deepSeekRes.text()
      const data = JSON.parse(body)
      const text = data?.choices?.[0]?.message?.content?.trim()
      if (!text) return res.status(500).json({ error: 'DeepSeek returned an empty response' })
      return res.json({ text })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const reader = deepSeekRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''

      for (const rawLine of parts) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const dataLine = line.slice(5).trim()
        if (!dataLine || dataLine === '[DONE]') continue

        try {
          const parsed = JSON.parse(dataLine)
          const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? ''
          if (!delta) continue
          res.write(`data: ${JSON.stringify({ text: delta })}\n\n`)
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'AI request failed' })
    } else {
      res.end()
    }
  }
})

// ── Static files ──────────────────────────────────────────────────────────────

if (await fs.access(distDir).then(() => true).catch(() => false)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// ── Global error handler — always returns JSON ────────────────────────────────

app.use((err, req, res, next) => {
  void next
  console.error('[Maestro] Unhandled error:', err)
  if (res.headersSent) return
  const status = err.status ?? err.statusCode ?? 500
  res.status(status).json({ error: err.message ?? 'Internal server error' })
})

// ── Startup ───────────────────────────────────────────────────────────────────

async function main() {
  await ensureDatabase()
  const tryPorts = process.env.PORT ? [requestedPort] : Array.from({ length: 10 }, (_, index) => requestedPort + index)

  for (const candidatePort of tryPorts) {
    try {
      httpServer = await new Promise((resolve, reject) => {
        const server = app.listen(candidatePort, host, () => resolve(server))
        server.once('error', reject)
      })
      httpServer.on('error', (error) => {
        console.error('[Maestro] HTTP server error:', error)
        process.exit(1)
      })
      console.log(`[Maestro] API listening on http://${host}:${candidatePort}`)
      return
    } catch (error) {
      if (process.env.PORT || error?.code !== 'EADDRINUSE') {
        throw error
      }
      console.warn(`[Maestro] Port ${candidatePort} is busy, trying ${candidatePort + 1}...`)
    }
  }

  throw new Error(`Unable to bind to any port starting at ${requestedPort}`)
}

main().catch((error) => {
  console.error('[Maestro] Startup failed:', error)
  process.exit(1)
})
