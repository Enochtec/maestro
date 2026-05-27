import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './contexts/AuthContext'
// Minimal markdown -> HTML renderer for basic headings, bold, lists, inline code, and fenced code blocks.
function markdownToHtml(md: string) {
  if (!md) return ''
  let out = md

  // Escape HTML
  out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Fenced code blocks
  out = out.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
    const cls = lang ? ` class="language-${lang}"` : ''
    return `<pre class="message-code-block"><code${cls}>${code.replace(/</g, '&lt;')}</code></pre>`
  })

  // Tables (pipe syntax)
  out = renderTables(out)

  // Headings
  out = out.replace(/^### (.*$)/gim, '<h3>$1</h3>')
  out = out.replace(/^## (.*$)/gim, '<h2>$1</h2>')
  out = out.replace(/^# (.*$)/gim, '<h1>$1</h1>')

  // Bold markers (strip the ** symbols to avoid noisy output)
  out = out.replace(/\*\*(.*?)\*\*/gim, '$1')

  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // Lists
  out = out.replace(/(^|\n)[*+-] (.*)/g, (_m, p1, item) => `${p1}<ul><li>${item}</li></ul>`)

  // Paragraphs
  out = out.replace(/^(?!<h|<ul|<pre|<code|<li)(.+)$/gm, '<p>$1</p>')

  return out
}

function splitTableRow(line: string) {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return []
  const cells = trimmed.split('|').map((cell) => cell.trim())
  if (cells.length <= 1) return []
  if (cells[0] === '') cells.shift()
  if (cells[cells.length - 1] === '') cells.pop()
  return cells
}

function parseTableAlignment(line: string) {
  const parts = splitTableRow(line)
  if (!parts.length) return null
  const aligns: Array<'left' | 'right' | 'center'> = []
  for (const part of parts) {
    const trimmed = part.replace(/\s+/g, '')
    if (!/^:?-+:?$/.test(trimmed)) return null
    const left = trimmed.startsWith(':')
    const right = trimmed.endsWith(':')
    if (left && right) aligns.push('center')
    else if (right) aligns.push('right')
    else aligns.push('left')
  }
  return aligns
}

function buildTableHtml(headerCells: string[], alignments: Array<'left' | 'right' | 'center'>, rows: string[][]) {
  const head = headerCells
    .map((cell, idx) => `<th style="text-align:${alignments[idx] ?? 'left'}">${cell}</th>`)
    .join('')
  const body = rows
    .map((row) =>
      `<tr>${row.map((cell, idx) => `<td style="text-align:${alignments[idx] ?? 'left'}">${cell}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function renderTables(md: string) {
  const lines = md.split('\n')
  const rendered: string[] = []
  let i = 0
  let inCodeBlock = false

  while (i < lines.length) {
    const line = lines[i]

    if (line.includes('<pre class="message-code-block">')) inCodeBlock = true
    if (inCodeBlock) {
      rendered.push(line)
      if (line.includes('</pre>')) inCodeBlock = false
      i += 1
      continue
    }

    const headerCells = splitTableRow(line)
    const alignment = i + 1 < lines.length ? parseTableAlignment(lines[i + 1]) : null

    if (headerCells.length && alignment) {
      const rows: string[][] = []
      i += 2
      while (i < lines.length) {
        const rowCells = splitTableRow(lines[i])
        if (!rowCells.length) break
        rows.push(rowCells)
        i += 1
      }
      rendered.push(buildTableHtml(headerCells, alignment, rows))
      continue
    }

    rendered.push(line)
    i += 1
  }

  return rendered.join('\n')
}
import './App.css'

type Role = 'user' | 'assistant'

type Message = {
  id: number
  role: Role
  content: string
  pending?: boolean
  streaming?: boolean
}

type TypingEntry = {
  fullText: string
  displayed: number
  done: boolean
  timer: ReturnType<typeof setInterval> | null
}

type Thread = {
  id: number
  title: string
}

type SidebarItem = {
  label: string
  icon: string
}

type Attachment = {
  id: string
  name: string
  type: string
  size: number
  kind: 'text' | 'image' | 'other'
  content?: string
  width?: number
  height?: number
  base64Data?: string
}

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api'
const brandLogoUrl = '/logo.svg'
const DEFAULT_THREAD_TITLE = 'New chat'
const MAX_TITLE_WORDS = 5
const MIN_TITLE_WORDS = 2
const ATTACHMENT_MARKER = '\n\nAttached files:\n'
const TITLE_UPPERCASE_WORDS = new Set(['ai', 'api', 'sql', 'db', 'ui', 'ux', 'otp', 'llm', 'pdf', 'cpu', 'gpu'])
const SIDEBAR_OVERLAY_BREAKPOINT = 1024
const TYPING_INTERVAL_MS = 28

const primaryActions: SidebarItem[] = [
  { label: 'New chat', icon: 'edit_square' },
  { label: 'Projects', icon: 'folder_open' },
]

const hiddenThreadTitles = new Set(['maestro launch', 'product notes', 'research digest'])

function summarizeTopic(text: string, maxWords = MAX_TITLE_WORDS) {
  const cleaned = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return ''

  const words = cleaned.split(' ').filter(Boolean)
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
  ])

  const topicWords = words.filter((word) => word.length > 2 && !stopWords.has(word))
  if (!topicWords.length) return ''

  return topicWords.slice(0, maxWords).join(' ')
}

function toTitleCase(text: string) {
  return text
    .split(' ')
    .filter(Boolean)
    .map((word) => (TITLE_UPPERCASE_WORDS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}

function normalizeAiText(text: string) {
  return text.replace(/[\u2013\u2014]/g, '-')
}

function stripAttachmentSummary(content: string) {
  const idx = content.indexOf(ATTACHMENT_MARKER)
  return (idx === -1 ? content : content.slice(0, idx)).trim()
}

function normalizePrompt(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function isMeaningfulPrompt(text: string) {
  const cleaned = normalizePrompt(text)
  if (!cleaned) return false
  const words = cleaned.split(' ').filter(Boolean)
  const nonTrivial = words.filter((word) => word.length > 2)
  const hasLongWord = words.some((word) => word.length >= 8)
  return cleaned.length >= 12 || nonTrivial.length >= 2 || hasLongWord
}

function buildChatTitleFromPrompt(prompt: string) {
  const combined = normalizePrompt(prompt)
  if (!combined) return ''

  const summary = summarizeTopic(combined, MAX_TITLE_WORDS)
  let words = summary.split(' ').filter(Boolean)

  const mergedWords: string[] = []
  for (let i = 0; i < words.length; i += 1) {
    const current = words[i]
    const next = words[i + 1]
    if (current === 'road' && next === 'map') {
      mergedWords.push('roadmap')
      i += 1
      continue
    }
    mergedWords.push(current)
  }
  words = mergedWords

  if (words.includes('roadmap')) {
    words = words.filter((word) => !['introduction', 'intro', 'beginner', 'basics'].includes(word))
  }

  if (words.length < MIN_TITLE_WORDS) {
    const cleaned = combined
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    words = cleaned.split(' ').filter(Boolean).filter((word) => word.length > 1).slice(0, MAX_TITLE_WORDS)
  }

  if (words.length === 1) {
    words = [words[0], 'overview']
  }

  if (words.length < MIN_TITLE_WORDS) return ''
  return toTitleCase(words.slice(0, MAX_TITLE_WORDS).join(' '))
}

function getMeaningfulPrompts(messages: Message[]) {
  const prompts = messages
    .filter((message) => message.role === 'user')
    .map((message) => stripAttachmentSummary(message.content))
    .map((prompt) => normalizePrompt(prompt))
    .filter(Boolean)

  return prompts.filter(isMeaningfulPrompt)
}

function cx(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(' ')
}

async function persistThreadMessage(threadId: number, role: Role, content: string, token: string | null) {
  const response = await fetch(`${apiBase}/threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ role, content }),
  })

  if (!response.ok) throw new Error(await response.text())
  return (await response.json()) as Message
}

async function createChatThread(title = DEFAULT_THREAD_TITLE, token: string | null = null) {
  const response = await fetch(`${apiBase}/threads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ title }),
  })

  if (!response.ok) throw new Error(await response.text())
  return (await response.json()) as Thread
}

function App() {
  const { user, token, logout } = useAuth()
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= SIDEBAR_OVERLAY_BREAKPOINT : true,
  )
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < SIDEBAR_OVERLAY_BREAKPOINT : false,
  )
  const [chatQuery, setChatQuery] = useState('')
  const [showAllRecents, setShowAllRecents] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isListening, setIsListening] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const skipNextThreadLoad = useRef(false)
  const recognitionRef = useRef<any>(null)
  const typingRef = useRef<Map<number, TypingEntry>>(new Map())

  const handleFilesSelected = async (files: FileList) => {
    const next: Attachment[] = []
    const textExtensions = ['.txt', '.md', '.csv', '.json', '.log']

    for (const file of Array.from(files)) {
      const lowerName = file.name.toLowerCase()
      const isText = file.type.startsWith('text/') || textExtensions.some((ext) => lowerName.endsWith(ext))
      const isImage = file.type.startsWith('image/')

      if (isText) {
        const raw = await file.text()
        const content = raw.length > 4000 ? `${raw.slice(0, 4000)}\n[truncated]` : raw
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          name: file.name,
          type: file.type,
          size: file.size,
          kind: 'text',
          content,
        })
        continue
      }

      if (isImage) {
        try {
          const [bitmap, base64Data] = await Promise.all([
            createImageBitmap(file),
            new Promise<string>((resolve, reject) => {
              const fr = new FileReader()
              fr.onload = () => resolve((fr.result as string).split(',')[1] ?? '')
              fr.onerror = reject
              fr.readAsDataURL(file)
            }),
          ])
          next.push({
            id: `${file.name}-${file.size}-${file.lastModified}`,
            name: file.name,
            type: file.type,
            size: file.size,
            kind: 'image',
            width: bitmap.width,
            height: bitmap.height,
            base64Data,
          })
          bitmap.close()
        } catch {
          next.push({
            id: `${file.name}-${file.size}-${file.lastModified}`,
            name: file.name,
            type: file.type,
            size: file.size,
            kind: 'image',
          })
        }
        continue
      }

      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        type: file.type,
        size: file.size,
        kind: 'other',
      })
    }

    setAttachments((current) => [...current, ...next])
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((att) => att.id !== id))
  }

  const buildAttachmentSummary = () => {
    if (!attachments.length) return ''
    const parts = attachments.map((att) => {
      if (att.kind === 'text') {
        return `File: ${att.name}\n${att.content ?? ''}`
      }
      if (att.kind === 'image') {
        const dims = att.width && att.height ? `${att.width}×${att.height}` : 'unknown dimensions'
        const sizeKb = Math.max(1, Math.round(att.size / 1024))
        return att.base64Data
          ? `[Image attached for visual analysis: ${att.name}, ${dims}, ${sizeKb} KB]`
          : `Image: ${att.name} (${att.type || 'image'}, ${dims}, ${sizeKb} KB)`
      }
      const sizeKb = Math.max(1, Math.round(att.size / 1024))
      return `File: ${att.name} (${att.type || 'unknown'}, ${sizeKb} KB) - no text extracted`
    })

    return `Attached files:\n${parts.join('\n\n')}`
  }
  const [toast, setToast] = useState<string | null>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  const getTypingStep = (length: number) => {
    if (length > 800) return 4
    if (length > 400) return 3
    return 2
  }

  const clearTypingEntry = (messageId: number) => {
    const entry = typingRef.current.get(messageId)
    if (entry?.timer) clearInterval(entry.timer)
    typingRef.current.delete(messageId)
  }

  const startTypingTimer = (messageId: number) => {
    const entry = typingRef.current.get(messageId)
    if (!entry || entry.timer) return

    entry.timer = setInterval(() => {
      const current = typingRef.current.get(messageId)
      if (!current) return

      const step = getTypingStep(current.fullText.length)
      const next = Math.min(current.displayed + step, current.fullText.length)
      if (next !== current.displayed) current.displayed = next

      setMessages((curr) =>
        curr.map((m) =>
          m.id === messageId
            ? { ...m, content: current.fullText.slice(0, current.displayed), pending: false, streaming: true }
            : m,
        ),
      )

      if (current.done && current.displayed >= current.fullText.length) {
        setMessages((curr) =>
          curr.map((m) =>
            m.id === messageId
              ? { ...m, content: current.fullText, pending: false, streaming: false }
              : m,
          ),
        )
        if (current.timer) clearInterval(current.timer)
        typingRef.current.delete(messageId)
      }
    }, TYPING_INTERVAL_MS)
  }

  const pushTypedChunk = (messageId: number, chunk: string) => {
    const entry = typingRef.current.get(messageId) ?? {
      fullText: '',
      displayed: 0,
      done: false,
      timer: null,
    }
    entry.fullText += chunk
    typingRef.current.set(messageId, entry)
    startTypingTimer(messageId)
  }

  const finalizeTypedMessage = (messageId: number, fullText: string) => {
    const entry = typingRef.current.get(messageId)
    if (!entry) {
      setMessages((curr) =>
        curr.map((m) =>
          m.id === messageId ? { ...m, content: fullText, pending: false, streaming: false } : m,
        ),
      )
      return
    }

    entry.fullText = fullText
    entry.done = true
    typingRef.current.set(messageId, entry)
    startTypingTimer(messageId)
  }

  const toggleVoiceInput = () => {
    if (typeof window === 'undefined') return
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      showToast('Voice input is not supported in this browser')
      return
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor()
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = 'en-US'

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results || [])
          .map((result: any) => result?.[0]?.transcript ?? '')
          .join(' ')
          .trim()
        if (transcript) {
          setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))
          inputRef.current?.focus()
        }
      }

      recognition.onerror = (event: any) => {
        setIsListening(false)
        if (event?.error) {
          showToast(`Voice input error: ${event.error}`)
        } else {
          showToast('Voice input error')
        }
      }

      recognition.onend = () => {
        setIsListening(false)
      }

      recognitionRef.current = recognition
    }

    if (isListening) {
      try {
        recognitionRef.current.stop()
      } catch {
        // ignore stop errors
      }
      setIsListening(false)
      return
    }

    try {
      recognitionRef.current.start()
      setIsListening(true)
    } catch (error) {
      setIsListening(false)
      showToast('Unable to start voice input')
      void error
    }
  }

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? threads[0] ?? { id: 0, title: 'Maestro AI' },
    [activeThreadId, threads],
  )
  const headerDisplayName = useMemo(() => {
    const fullName = user?.name?.trim() ?? ''
    if (!fullName) return 'Maestro'
    return fullName.split(/\s+/)[0]
  }, [user?.name])
  const activeThreadTitle = useMemo(() => activeThread.title, [activeThread.title])
  const fetchThreadMessages = async (threadId: number) => {
    const response = await fetch(`${apiBase}/threads/${threadId}/messages`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) throw new Error(await response.text())
    const data = (await response.json()) as { messages?: Message[] }
    return data.messages ?? []
  }
  const welcomeMessage = useMemo(() => {
    const firstName = headerDisplayName
    return `Welcome ${firstName}, How may I help today?`
  }, [headerDisplayName])
  const welcomeLine = useMemo(() => 'What challenge are we solving today?', [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        const response = await fetch(`${apiBase}/threads`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!response.ok) throw new Error(await response.text())
        const data = (await response.json()) as { threads?: Thread[] }
        if (cancelled) return

        const loadedThreads = data.threads ?? []
        if (loadedThreads[0]?.id) {
          setThreads(loadedThreads)
          setActiveThreadId((current) => current ?? loadedThreads[0].id ?? null)

          const firstMessages = await fetchThreadMessages(loadedThreads[0].id)
          if (cancelled) return
          setMessages(firstMessages)
        } else {
          const thread = await createChatThread('New chat', token)
          if (cancelled) return

          const welcome = {
            id: Date.now(),
            role: 'assistant' as Role,
            content: welcomeMessage,
          }

          setThreads([thread])
          setActiveThreadId(thread.id)
          setMessages([welcome])
          await persistThreadMessage(thread.id, 'assistant', welcomeMessage, token)
        }
      } catch (bootError) {
        if (!cancelled) {
          setError(bootError instanceof Error ? bootError.message : 'Failed to load chats')
        }
      } finally {
        if (!cancelled) setIsBootstrapping(false)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [welcomeMessage])

  useEffect(() => {
    const updateViewport = () => {
      const mobile = window.innerWidth < SIDEBAR_OVERLAY_BREAKPOINT
      setIsMobileViewport(mobile)
      if (mobile) setIsSidebarOpen(false)
    }

    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  useEffect(() => {
    if (!activeThreadId) return
    if (isSending) return
    if (skipNextThreadLoad.current) {
      skipNextThreadLoad.current = false
      return
    }

    let cancelled = false

    const loadMessages = async () => {
      try {
        const nextMessages = await fetchThreadMessages(activeThreadId)
        if (!cancelled) setMessages(nextMessages)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load messages')
        }
      }
    }

    void loadMessages()

    return () => {
      cancelled = true
    }
  }, [activeThreadId, isSending])

  const callAIStream = async (
    conversation: Message[],
    currentAttachments: Attachment[],
    onDelta: (chunk: string) => void,
  ) => {
    const response = await fetch(`${apiBase}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages: conversation.map((m) => ({ role: m.role, content: m.content })),
        attachments: currentAttachments
          .filter((att) => att.base64Data)
          .map((att) => ({ kind: att.kind, name: att.name, type: att.type, base64Data: att.base64Data })),
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(body || 'AI request failed')
    }

    if (!response.body) {
      const body = await response.text()
      const data = JSON.parse(body) as { text?: string }
      const text = data.text?.trim()
      if (!text) throw new Error('AI returned an empty response')
      const normalized = normalizeAiText(text)
      onDelta(normalized)
      return normalized
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''

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
          const parsed = JSON.parse(dataLine) as { text?: string }
          const delta = normalizeAiText(parsed.text ?? '')
          if (!delta) continue
          fullText += delta
          onDelta(delta)
        } catch {
          // ignore malformed SSE payloads
        }
      }
    }

    if (!fullText) throw new Error('AI returned an empty response')
    return fullText
  }

  const updateThreadTitle = async (threadId: number, title: string) => {
    const response = await fetch(`${apiBase}/threads/${threadId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ title }),
    })

    if (!response.ok) throw new Error(await response.text())
    const updated = (await response.json()) as Thread
    setThreads((curr) => {
      const exists = curr.some((thread) => thread.id === updated.id)
      if (!exists) return [updated, ...curr]
      return curr.map((thread) => (thread.id === updated.id ? { ...thread, title: updated.title } : thread))
    })
  }

  const maybeGenerateThreadTitle = async (
    threadId: number,
    currentTitle: string,
    nextMessages: Message[],
  ) => {
    const normalizedCurrent = currentTitle.trim().toLowerCase()
    if (normalizedCurrent !== DEFAULT_THREAD_TITLE.toLowerCase()) return

    const meaningfulPrompt = getMeaningfulPrompts(nextMessages)[0]
    if (!meaningfulPrompt) return

    const title = buildChatTitleFromPrompt(meaningfulPrompt)
    if (!title) return

    try {
      await updateThreadTitle(threadId, title)
    } catch (err) {
      console.warn('[Maestro] Failed to update thread title', err)
    }
  }

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim()
    if (!text || isSending) return

    const currentAttachments = [...attachments]
    const attachmentSummary = buildAttachmentSummary()
    const messageText = attachmentSummary ? `${text}\n\n${attachmentSummary}` : text

    setError(null)
    setIsSending(true)

    const userMsg: Message = { id: Date.now(), role: 'user', content: messageText }
    const placeholder: Message = {
      id: userMsg.id + 1,
      role: 'assistant',
      content: '',
      pending: true,
      streaming: true,
    }

    setMessages((m) => [...m, userMsg, placeholder])
    setInput('')
    setAttachments([])

    try {
      let threadId = activeThreadId
      let currentThreadTitle = activeThread.title
      if (!threadId) {
        const thread = await createChatThread(DEFAULT_THREAD_TITLE, token)
        skipNextThreadLoad.current = true
        setThreads((curr) => [thread, ...curr])
        setActiveThreadId(thread.id)
        threadId = thread.id
        currentThreadTitle = thread.title
      }

      await persistThreadMessage(threadId, 'user', messageText, token)

      const nextMessages = [...messages, userMsg]
      await maybeGenerateThreadTitle(threadId, currentThreadTitle, nextMessages)

      let responseText = ''
      await callAIStream([...messages, userMsg], currentAttachments, (chunk) => {
        responseText += chunk
        pushTypedChunk(placeholder.id, chunk)
      })
      finalizeTypedMessage(placeholder.id, responseText)
      await persistThreadMessage(threadId, 'assistant', responseText, token)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg)
      clearTypingEntry(placeholder.id)
      setMessages((curr) => curr.filter((m) => m.id !== placeholder.id))
    } finally {
      setIsSending(false)
    }
  }

  const startNewChat = () => {
    // Start a local, unsaved chat. We will create/persist the server thread
    // only when the user actually sends the first message (see sendMessage).
    setActiveThreadId(null)
    setMessages([])
    setInput('')
    setError(null)
  }

  const filteredThreads = threads.filter((t) => {
    const s = chatQuery.trim().toLowerCase()
    if (hiddenThreadTitles.has(t.title.trim().toLowerCase())) return false
    if (t.title.trim().toLowerCase() === DEFAULT_THREAD_TITLE.toLowerCase()) return false
    return !s || t.title.toLowerCase().includes(s)
  })
  const visibleRecents =
    showAllRecents || chatQuery.trim() ? filteredThreads : filteredThreads.slice(0, 6)

  const hasConversation = messages.length > 0
  const legacyWelcomeRegex = /how may i/i
  const isWelcomeOnly =
    messages.length === 0 ||
    (messages.length === 1 && messages[0]?.role === 'assistant' && legacyWelcomeRegex.test(messages[0]?.content ?? ''))

  const visibleMessages = messages.filter(
    (message) => !(message.role === 'assistant' && legacyWelcomeRegex.test(message.content ?? '')),
  )

  function MessageBubble({ message }: { message: Message }) {
    const [copied, setCopied] = useState(false)
    const [liked, setLiked] = useState(false)
    const [disliked, setDisliked] = useState(false)

    // detect fenced code blocks ```
    const codeMatch = /```(?:[\s\S]*?\n)?([\s\S]*?)```/.exec(message.content)
    const hasCode = Boolean(codeMatch)
    const codeText = codeMatch ? codeMatch[1].trim() : ''

    const copyCode = async () => {
      try {
        await navigator.clipboard.writeText(codeText)
        setCopied(true)
        showToast('Copied to clipboard')
        setTimeout(() => setCopied(false), 1800)
      } catch (error) {
        void error
      }
    }

    return (
      <article className={cx('message-row', message.role === 'user' ? 'user' : 'assistant')}>
        {message.pending ? (
          <div className="avatar" aria-hidden>
            <span className="material-symbols-rounded" style={{ fontSize: 14 }}>smart_toy</span>
          </div>
        ) : null}

        <div className={cx('flex min-w-0 flex-col', message.role === 'user' ? 'items-end' : 'items-start')}>
          <div
            className={cx(
              'message-container max-w-[540px] text-sm leading-relaxed',
              message.role === 'user' ? 'user self-end ml-10 md:ml-20' : 'assistant self-start mr-10 md:mr-20',
            )}
          >
          {message.pending ? (
            <div className="flex items-center gap-3">
              <div className="typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div className="text-[#a9a39c] italic">Maestro is thinking...</div>
            </div>
          ) : hasCode ? (
            <div className="relative message-code">
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <code>{codeText}</code>
              </pre>
              <button className="code-copy-btn" onClick={copyCode} aria-label="Copy code">
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                  content_copy
                </span>
              </button>
              {copied && <div className="copied-badge show">Copied</div>}
            </div>
          ) : (
            <div>
              <div className="prose text-[#eae6df] message-body streaming">
                <div dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }} />
              </div>
            </div>
          )}
          </div>

          {message.role !== 'user' && (
            <div className={cx('message-actions', isMobileViewport && 'always-show')}>
              <button
                className="action-btn"
                title="Copy message"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(message.content)
                    setCopied(true)
                    showToast('Copied to clipboard')
                    setTimeout(() => setCopied(false), 1400)
                  } catch (error) {
                    void error
                  }
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>content_copy</span>
              </button>

              <button className={cx('action-btn', liked && 'bg-[#2fbf71]/20')} title="Like" onClick={() => setLiked((s) => !s)}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>thumb_up</span>
              </button>

              <button className={cx('action-btn', disliked && 'bg-white/[0.03]')} title="Dislike" onClick={() => setDisliked((s) => !s)}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>thumb_down</span>
              </button>

              <button className="action-btn" title="Regenerate" onClick={() => { /* noop: wire to regen */ }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>refresh</span>
              </button>

              <button
                className="action-btn"
                title="Read aloud"
                onClick={() => {
                  try {
                    const ut = new SpeechSynthesisUtterance(message.content)
                    speechSynthesis.cancel()
                    speechSynthesis.speak(ut)
                  } catch (error) {
                    void error
                  }
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>volume_up</span>
              </button>
            </div>
          )}

        </div>
      </article>
    )
  }

  // composerInner should be available in the JSX below
  const composerInner = (
    <div className="composer-wrap">
      {error && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-sm flex-shrink-0">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void sendMessage(input)
        }}
        className="composer-shell"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.json,.log"
          className="hidden"
          onChange={async (event) => {
            const files = event.target.files
            if (!files?.length) return
            await handleFilesSelected(files)
            event.target.value = ''
          }}
        />
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((att) => (
              <span
                key={att.id}
                className="composer-attachment"
              >
                {att.name}
                <button
                  type="button"
                  className="composer-attachment-remove"
                  aria-label={`Remove ${att.name}`}
                  onClick={() => removeAttachment(att.id)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="composer-btn composer-btn-left"
            aria-label="Add files"
            title="Add files"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24" }}
            >
              add
            </span>
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendMessage(input)
              }
            }}
            placeholder="Ask  anything"
            className="composer-input"
          />
          <div className="composer-actions">
            <button
              type="button"
              className={cx('composer-btn composer-btn-mic', isListening && 'is-listening')}
              aria-label="Voice input"
              title="Voice input"
              onClick={toggleVoiceInput}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24" }}
              >
                mic
              </span>
            </button>
            <button
              type="submit"
              disabled={isSending || isBootstrapping}
              className="composer-btn composer-btn-voice"
              aria-label="Send message"
              title="Send message"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24" }}
              >
                {isSending ? 'hourglass_top' : 'send'}
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-[#08090d] text-[#f3efe7]">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {(isSidebarOpen || !isMobileViewport) && (
        <aside className={cx(
          'bg-[#070708] border-r border-white/[0.04] h-screen overflow-hidden flex flex-col sidebar-panel',
          isMobileViewport && 'fixed left-0 top-0 z-30',
          !isMobileViewport && 'flex-shrink-0',
          isSidebarOpen ? 'w-64 pl-4 pr-3 pt-4 pb-3' : 'w-14 p-3',
        )}>
        {isSidebarOpen ? (
          <>
            <div className="flex items-center justify-between gap-3 mb-4 pr-2 flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src={brandLogoUrl}
                  alt="Maestro AI"
                  className="h-5 w-5 rounded-lg object-cover flex-shrink-0 bg-white/5 shadow-lg"
                />
                <h1 className="text-xs font-semibold whitespace-nowrap truncate">Maestro AI</h1>
              </div>
              <button
                type="button"
                className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Close sidebar"
                title="Close sidebar"
              >
                <svg
                  className="w-4 h-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect width="18" height="18" x="3" y="3" rx="4" />
                  <path d="M9 3v18" />
                </svg>
              </button>
            </div>

            <div className="sidebar-scroll thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
              <div className="px-0">
                {primaryActions.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => item.label === 'New chat' && startNewChat()}
                    className="flex items-center gap-3 w-full text-left px-0 py-3 rounded hover:bg-white/[0.02] sidebar-text"
                  >
                    <span className="material-symbols-rounded sidebar-icon sidebar-icon-wrap flex-shrink-0">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              <div className="px-0 mt-1">
                <label className="flex items-center gap-2 px-0 py-3 rounded-xl cursor-text">
                  <span className="material-symbols-rounded sidebar-icon sidebar-icon-wrap">
                    search
                  </span>
                  <input
                    id="chat-search"
                    type="search"
                    value={chatQuery}
                    onChange={(e) => setChatQuery(e.target.value)}
                    placeholder="Search chats"
                    className="flex-1 bg-transparent border-none outline-none sidebar-text sidebar-search-input"
                  />
                </label>
              </div>

              <div className="px-0 mt-1">
                <div className="flex items-center gap-2 px-0 py-2.5 sidebar-text font-semibold tracking-wide">
                  <span className="material-symbols-rounded sidebar-icon sidebar-icon-wrap">history</span>
                  <span>Recents</span>
                  {filteredThreads.length > 6 && !chatQuery.trim() && (
                    <button
                      type="button"
                      className="ml-auto w-5 h-5 inline-flex items-center justify-center rounded-md hover:bg-white/[0.04] transition-colors"
                      title={showAllRecents ? 'Show fewer chats' : 'Show more chats'}
                      aria-label={showAllRecents ? 'Show fewer chats' : 'Show more chats'}
                      onClick={() => setShowAllRecents((prev) => !prev)}
                    >
                      <span className="material-symbols-rounded sidebar-icon">more_horiz</span>
                    </button>
                  )}
                </div>
                {visibleRecents.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className="w-full text-left px-4 py-2.5 sidebar-text font-medium mb-1 transition-colors truncate whitespace-nowrap"
                    onClick={() => setActiveThreadId(thread.id)}
                  >
                    {thread.id === activeThreadId ? activeThreadTitle : thread.title}
                  </button>
                ))}
                {filteredThreads.length === 0 && (
                  <p className="px-0 py-2.5 sidebar-text">No recent chats</p>
                )}
              </div>
            </div>

            <div className="sidebar-footer flex flex-col gap-1 px-0 pt-2.5 pb-4 border-t border-white/[0.06] w-full flex-shrink-0">
              <button
                type="button"
                className="flex items-center gap-2 px-0 py-3 sidebar-text font-semibold transition-colors"
                title="Settings"
              >
                <span className="material-symbols-rounded sidebar-icon sidebar-icon-wrap flex-shrink-0">
                  settings
                </span>
                <span>Settings</span>
              </button>

              <div className="flex items-center gap-2 px-0 py-3">
                {user?.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    className="w-5 h-5 rounded-full flex-shrink-0 object-cover"
                  />
                ) : (
                  <span className="material-symbols-rounded sidebar-icon sidebar-icon-wrap flex-shrink-0">
                    account_circle
                  </span>
                )}
                <strong className="sidebar-text truncate">{user?.name ?? 'Maestro GPT'}</strong>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 pt-2">
            <button
              type="button"
              className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              <svg
                className="w-4 h-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect width="18" height="18" x="3" y="3" rx="4" />
                <path d="M9 3v18" />
              </svg>
            </button>
            {primaryActions.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  if (item.label === 'New chat') startNewChat()
                  setIsSidebarOpen(true)
                }}
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-white/[0.06]"
                title={item.label}
                aria-label={item.label}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                  {item.icon}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-white/[0.06]"
              title="Search"
              aria-label="Search"
              onClick={() => setIsSidebarOpen(true)}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>search</span>
            </button>
            <button
              type="button"
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-white/[0.06]"
              title="Recents"
              aria-label="Recents"
              onClick={() => setIsSidebarOpen(true)}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>history</span>
            </button>
            <button
              type="button"
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-white/[0.06]"
              title="Settings"
              aria-label="Settings"
              onClick={() => setIsSidebarOpen(true)}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>settings</span>
            </button>
            <button
              type="button"
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-white/[0.06]"
              title={user?.name ?? 'Profile'}
              aria-label="Profile"
              onClick={() => setIsSidebarOpen(true)}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>account_circle</span>
            </button>
          </div>
        )}
        </aside>
      )}

      <main
        className="flex w-full flex-1 min-w-0 flex-col overflow-hidden"
        onClick={() => {
          if (isSidebarOpen && isMobileViewport) setIsSidebarOpen(false)
        }}
      >
        <header className="flex items-center gap-2 px-4 py-2.5 md:px-6 border-b border-white/[0.06] flex-shrink-0">
          {isMobileViewport && !isSidebarOpen && (
            <button
              type="button"
              className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              <svg
                className="w-4 h-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect width="18" height="18" x="3" y="3" rx="4" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}
          {!isSidebarOpen && (
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={brandLogoUrl}
                alt="Maestro AI"
                className="h-6 w-6 rounded-lg object-cover flex-shrink-0"
              />
              <span className="text-sm font-semibold text-[#f3efe7] truncate">Maestro AI</span>
            </div>
          )}
          <div className="flex items-center gap-2 min-w-0 ml-auto">
            <h2 className="font-semibold text-xs truncate">{headerDisplayName}</h2>
            <button
              type="button"
              className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors flex-shrink-0"
              aria-label="Logout"
              onClick={() => setShowLogoutConfirm(true)}
            >
              <svg
                className="w-4 h-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10 7v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-2" />
                <path d="M15 12H3" />
                <path d="M7 8l-4 4 4 4" />
              </svg>
            </button>
          </div>
        </header>
        <div className={cx('flex-1 overflow-hidden flex flex-col p-4 md:p-6', hasConversation ? 'gap-4' : 'justify-center')}>
          {isWelcomeOnly && (
            <div className="flex-1 min-h-0 flex items-center justify-center px-4 text-center">
              <div className="w-full max-w-[52rem] px-2 py-2 bg-transparent mb-2">
                <h2 className="mx-auto text-center text-sm sm:text-sm md:text-base font-medium leading-snug text-[#f7f2ea] break-words mb-6">
                  {welcomeLine}
                </h2>
                {composerInner}
              </div>
            </div>
          )}

          {!isWelcomeOnly && hasConversation && (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 thin-scrollbar">
              {visibleMessages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}

          {!isWelcomeOnly && (
            <div className={cx('w-full', hasConversation ? 'mt-auto' : 'flex items-center justify-center min-h-0')}>
              {composerInner}
            </div>
          )}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div
          key={toast}
          className="toast-enter fixed top-5 left-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/[0.08] shadow-2xl pointer-events-none"
          style={{ background: 'rgba(18,19,24,0.96)' }}
        >
          <span className="material-symbols-outlined text-[#2fbf71]" style={{ fontSize: 14 }}>check_circle</span>
          <span className="text-xs font-medium text-[#f3efe7]">{toast}</span>
        </div>
      )}

      {/* Logout confirmation */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="w-64 rounded-2xl border border-white/[0.08] p-5 shadow-2xl"
            style={{ background: 'rgba(12,13,17,0.98)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xs font-semibold text-[#f3efe7] mb-1">Log out?</h3>
            <p className="text-xs text-[#6b6560] mb-5">You'll need to sign in again to continue.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-[#a9a39c] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { logout(); setShowLogoutConfirm(false) }}
                className="px-3 py-1.5 rounded-lg bg-[#2fbf71] hover:bg-[#3ad784] text-[#100d0c] text-xs font-semibold transition-colors"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

