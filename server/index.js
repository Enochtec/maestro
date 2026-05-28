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
const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? process.env.VITE_TAVILY_API_KEY

let pool
let httpServer

// Simple in-memory TTL cache to reduce DB hits for frequently-read endpoints.
// Keyed by strings; stores { value, expiresAt }.
const simpleCache = new Map()

function setCache(key, value, ttlMs = 10000) {
  const expiresAt = Date.now() + ttlMs
  simpleCache.set(key, { value, expiresAt })
}

function getCache(key) {
  const entry = simpleCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    simpleCache.delete(key)
    return null
  }
  return entry.value
}

function delCache(key) {
  simpleCache.delete(key)
}

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

function normalizePrompt(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeKnowledgeKey(text) {
  return normalizePrompt(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getKnowledgeTokens(text) {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'can',
    'do',
    'for',
    'from',
    'how',
    'i',
    'in',
    'is',
    'it',
    'me',
    'of',
    'on',
    'or',
    'show',
    'tell',
    'the',
    'to',
    'what',
    'when',
    'where',
    'which',
    'with',
    'why',
    'would',
    'you',
    'help',
    'issue',
    'problem',
    'question',
    'support',
    'request',
    'please',
    'want',
    'need',
    'latest',
    'current',
    'today',
    'now',
    'recent',
  ])

  return normalizeKnowledgeKey(text)
    .split(' ')
    .filter((word) => word.length > 2 && !stopWords.has(word))
}

function shouldStoreKnowledge(prompt, answer) {
  const text = `${prompt}\n${answer}`
  if (!prompt || !answer) return false
  if (prompt.length < 18) return false
  if (answer.length < 80) return false
  if (/(api[_-]?key|password|secret|token|bearer|private key|ssh|credit card|ssn)/i.test(text)) return false
  return true
}

function summarizeKnowledge(prompt, answer) {
  const cleanedPrompt = normalizePrompt(prompt).slice(0, 120)
  const cleanedAnswer = normalizePrompt(answer).slice(0, 900)
  return `Q: ${cleanedPrompt}\nA: ${cleanedAnswer}`.trim()
}

async function storeSharedKnowledge(threadId, sourceMessageId, prompt, answer) {
  if (!shouldStoreKnowledge(prompt, answer)) return

  const promptKey = normalizeKnowledgeKey(prompt)
  if (!promptKey) return

  await pool.query(
    `
      INSERT INTO shared_knowledge (
        prompt_key,
        prompt,
        summary,
        answer,
        source_thread_id,
        source_message_id,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (prompt_key)
      DO UPDATE SET
        prompt = EXCLUDED.prompt,
        summary = EXCLUDED.summary,
        answer = EXCLUDED.answer,
        source_thread_id = EXCLUDED.source_thread_id,
        source_message_id = EXCLUDED.source_message_id,
        updated_at = NOW()
    `,
    [promptKey, prompt, summarizeKnowledge(prompt, answer), answer.slice(0, 2500), threadId, sourceMessageId],
  )
}

async function findRelevantKnowledge(prompt) {
  const queryTokens = getKnowledgeTokens(prompt)
  if (!queryTokens.length) return []

  const { rows } = await pool.query(
    'SELECT id, prompt, summary, answer, updated_at FROM shared_knowledge ORDER BY updated_at DESC, id DESC LIMIT 200',
  )

  return rows
    .map((row) => {
      const haystack = `${row.prompt} ${row.summary} ${row.answer}`.toLowerCase()
      const rowTokens = new Set(getKnowledgeTokens(haystack))
      let score = 0

      for (const token of queryTokens) {
        if (haystack.includes(token)) score += 2
        if (rowTokens.has(token)) score += 1
      }

      if (normalizeKnowledgeKey(row.prompt) === normalizeKnowledgeKey(prompt)) score += 8

      return { ...row, score }
    })
    .filter((row) => row.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

function extractLatestUserPrompt(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg?.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
      return msg.content.trim()
    }
  }
  return ''
}

function shouldUseWebSearch(prompt) {
  if (!prompt) return false
  const text = prompt.toLowerCase()
  const triggers = [
    'latest',
    'today',
    'current',
    'now',
    'recent',
    'news',
    'real-time',
    'realtime',
    'live',
    'web',
    'online',
    'search',
    'price',
    'stock',
    'weather',
    'score',
    'update',
  ]
  return triggers.some((keyword) => text.includes(keyword))
}

async function tavilyWebSearch(query) {
  if (!TAVILY_API_KEY || !query) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        include_answer: true,
        include_raw_content: false,
        max_results: 5,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(body || `Tavily error (${response.status})`)
    }

    const data = await response.json()
    const answer = typeof data?.answer === 'string' ? data.answer.trim() : ''
    const results = Array.isArray(data?.results) ? data.results : []
    const top = results.slice(0, 4)

    if (!answer && !top.length) return null

    const sources = top
      .map((item, index) => {
        const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : `Source ${index + 1}`
        const url = typeof item?.url === 'string' ? item.url : ''
        const content = typeof item?.content === 'string' ? item.content.trim() : ''
        return `- ${title} (${url})${content ? `: ${content.slice(0, 260)}` : ''}`
      })
      .join('\n')

    return {
      answer,
      sources,
    }
  } finally {
    clearTimeout(timeout)
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
    const cacheKey = `threads:${req.userId}`
    const cached = getCache(cacheKey)
    if (cached) return res.json({ threads: cached })

    const { rows } = await pool.query(
      'SELECT id, title FROM threads WHERE user_id = $1 ORDER BY updated_at DESC, id DESC',
      [req.userId],
    )
    setCache(cacheKey, rows, 15000) // cache for 15s
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
    // Invalidate cached thread list for this user
    delCache(`threads:${req.userId}`)
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
    // Invalidate cached thread list for this user
    delCache(`threads:${req.userId}`)
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
    const cacheKey = `messages:${req.userId}:${threadId}`
    const cached = getCache(cacheKey)
    if (cached) return res.json({ messages: cached })

    const { rows } = await pool.query(
      'SELECT id, role, content, pending, created_at FROM messages WHERE thread_id = $1 ORDER BY created_at ASC, id ASC',
      [threadId],
    )
    setCache(cacheKey, rows, 20000) // cache messages for 20s
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

    if (role === 'assistant') {
      const previousUser = await pool.query(
        'SELECT content FROM messages WHERE thread_id = $1 AND role = $2 ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET 0',
        [threadId, 'user'],
      )
      const userPrompt = previousUser.rows[0]?.content ?? ''
      await storeSharedKnowledge(threadId, rows[0].id, userPrompt, content)
    }

    // Invalidate caches for this thread and user's thread list
    delCache(`messages:${req.userId}:${threadId}`)
    delCache(`threads:${req.userId}`)
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
    'If asked who built you (or similar questions), reply that you were built by a student from the University of Eldoret named Enock Juma. ' +
    'Formatting rules: never use the asterisk character. Do not output markdown bullets with *. Use numbered lists or hyphen bullets. ' +
    'For main topics and subtopics, format with markdown headings (#, ##, ###) and optionally __double-underscore bold__ labels.'

  try {
    const latestPrompt = extractLatestUserPrompt(messages)
    let liveWebContext = ''
    let sharedMemoryContext = ''

    try {
      const memories = await findRelevantKnowledge(latestPrompt)
      if (memories.length) {
        sharedMemoryContext = memories
          .map((item, index) => `Memory ${index + 1}:\n${item.summary}`)
          .join('\n\n')
      }
    } catch (memoryErr) {
      console.warn('[Maestro] Shared memory lookup failed:', memoryErr instanceof Error ? memoryErr.message : memoryErr)
    }

    if (shouldUseWebSearch(latestPrompt)) {
      try {
        const webResult = await tavilyWebSearch(latestPrompt)
        if (webResult) {
          const parts = []
          if (webResult.answer) parts.push(`Tavily summary: ${webResult.answer}`)
          if (webResult.sources) parts.push(`Web sources:\n${webResult.sources}`)
          if (parts.length) liveWebContext = parts.join('\n\n')
        }
      } catch (webErr) {
        console.warn('[Maestro] Tavily search failed:', webErr instanceof Error ? webErr.message : webErr)
      }
    }

    const systemMessages = [{ role: 'system', content: systemText }]
    if (liveWebContext) {
      systemMessages.push({
        role: 'system',
        content:
          'Use this live web context as optional reference for freshness. If unsure, say so and avoid overclaiming.\n\n' +
          liveWebContext,
      })
    }

    if (sharedMemoryContext) {
      systemMessages.push({
        role: 'system',
        content:
          'Use this shared memory from prior chats as a reusable research base. If the same topic appears again, improve or update the answer instead of repeating it verbatim. Do not mention internal memory.\n\n' +
          sharedMemoryContext,
      })
    }

    const deepSeekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepSeekApiKey}`,
      },
      body: JSON.stringify({
        model: deepSeekModel,
        stream: true,
        messages: [...systemMessages, ...messages.map((m) => ({ role: m.role, content: m.content }))],
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
      const text = data?.choices?.[0]?.message?.content?.trim()?.replace(/\*/g, '')
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
          const rawDelta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? ''
          const delta = typeof rawDelta === 'string' ? rawDelta.replace(/\*/g, '') : ''
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
