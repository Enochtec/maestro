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

  // Headings
  out = out.replace(/^### (.*$)/gim, '<h3>$1</h3>')
  out = out.replace(/^## (.*$)/gim, '<h2>$1</h2>')
  out = out.replace(/^# (.*$)/gim, '<h1>$1</h1>')

  // Bold
  out = out.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')

  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // Lists
  out = out.replace(/(^|\n)\* (.*)/g, (_m, p1, item) => `${p1}<ul><li>${item}</li></ul>`)

  // Paragraphs
  out = out.replace(/^(?!<h|<ul|<pre|<code|<li)(.+)$/gm, '<p>$1</p>')

  return out
}
import './App.css'
import maestroLogo from './maestro_logo.png'

type Role = 'user' | 'assistant'

type Message = {
  id: number
  role: Role
  content: string
  pending?: boolean
  streaming?: boolean
}

type Thread = {
  id: number
  title: string
}

type SidebarItem = {
  label: string
  icon: string
}

const deepSeekApiKey = import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined
const deepSeekModel = import.meta.env.VITE_DEEPSEEK_MODEL ?? 'deepseek-chat'
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api'

const primaryActions: SidebarItem[] = [
  { label: 'New chat', icon: 'edit_square' },
  { label: 'Projects', icon: 'folder_open' },
]

const hiddenThreadTitles = new Set(['maestro launch', 'product notes', 'research digest'])

function summarizeTopic(text: string) {
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
  ])

  const topicWords = words.filter((word) => word.length > 2 && !stopWords.has(word))
  if (!topicWords.length) return ''

  return topicWords.slice(0, 5).join(' ')
}

function toTitleCase(text: string) {
  return text
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function cx(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(' ')
}

async function persistThreadMessage(threadId: number, role: Role, content: string) {
  const response = await fetch(`${apiBase}/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, content }),
  })

  if (!response.ok) throw new Error(await response.text())
  return (await response.json()) as Message
}

async function createChatThread(title = 'New chat') {
  const response = await fetch(`${apiBase}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })

  if (!response.ok) throw new Error(await response.text())
  return (await response.json()) as Thread
}

function App() {
  const { user, logout } = useAuth()
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  )
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  )
  const [chatQuery, setChatQuery] = useState('')
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? threads[0] ?? { id: 0, title: 'Maestro AI' },
    [activeThreadId, threads],
  )
  const headerDisplayName = useMemo(() => {
    const fullName = user?.name?.trim() ?? ''
    if (!fullName) return 'Maestro'
    return fullName.split(/\s+/)[0]
  }, [user?.name])
  const topicTitle = useMemo(() => {
    const rawTopic = summarizeTopic(input)
    return rawTopic ? toTitleCase(rawTopic) : ''
  }, [input])
  const activeThreadTitle = useMemo(() => {
    if (activeThreadId && topicTitle && activeThread.id === activeThreadId) {
      return topicTitle
    }
    return activeThread.title
  }, [activeThread, activeThreadId, topicTitle])
  const fetchThreadMessages = async (threadId: number) => {
    const response = await fetch(`${apiBase}/threads/${threadId}/messages`)
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
        const response = await fetch(`${apiBase}/threads`)
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
          const thread = await createChatThread('New chat')
          if (cancelled) return

          const welcome = {
            id: Date.now(),
            role: 'assistant' as Role,
            content: welcomeMessage,
          }

          setThreads([thread])
          setActiveThreadId(thread.id)
          setMessages([welcome])
          await persistThreadMessage(thread.id, 'assistant', welcomeMessage)
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
      const mobile = window.innerWidth < 768
      setIsMobileViewport(mobile)
      if (mobile) setIsSidebarOpen(false)
    }

    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  useEffect(() => {
    if (!activeThreadId) return

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
  }, [activeThreadId])

  useEffect(() => {
    if (!activeThreadId) return
    if (!topicTitle) return
    if (activeThread.title === topicTitle) return

    void fetch(`${apiBase}/threads/${activeThreadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: topicTitle }),
    })
  }, [activeThreadId, activeThread.title, topicTitle])

  const callDeepSeekStream = async (
    conversation: Message[],
    onDelta: (chunk: string) => void,
  ) => {
    if (!deepSeekApiKey) throw new Error('Missing VITE_DEEPSEEK_API_KEY in .env.local')

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepSeekApiKey}`,
      },
      body: JSON.stringify({
        model: deepSeekModel,
        stream: true,
        messages: [
          {
            role: 'system',
            content:
              'You are Maestro, a concise, polished AI assistant inside a React chat app. Be helpful, direct, and practical.',
          },
          ...conversation.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(body || 'DeepSeek request failed')
    }

    if (!response.body) {
      const body = await response.text()
      const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> }
      const text = data.choices?.[0]?.message?.content?.trim()
      if (!text) throw new Error('DeepSeek returned an empty response')
      onDelta(text)
      return text
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
          const parsed = JSON.parse(dataLine) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
          }
          const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? ''
          if (!delta) continue
          fullText += delta
          onDelta(delta)
        } catch {
          // ignore malformed SSE payloads
        }
      }
    }

    if (!fullText) throw new Error('DeepSeek returned an empty response')
    return fullText
  }

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim()
    if (!text || isSending) return

    setError(null)
    setIsSending(true)

    const userMsg: Message = { id: Date.now(), role: 'user', content: text }
    const placeholder: Message = {
      id: userMsg.id + 1,
      role: 'assistant',
      content: '',
      pending: true,
      streaming: true,
    }

    setMessages((m) => [...m, userMsg, placeholder])
    setInput('')

    try {
      let threadId = activeThreadId
      if (!threadId) {
        const thread = await createChatThread(topicTitle || 'New chat')
        setThreads((curr) => [thread, ...curr])
        setActiveThreadId(thread.id)
        threadId = thread.id
      }

      await persistThreadMessage(threadId, 'user', text)

      let responseText = ''
      await callDeepSeekStream([...messages, userMsg], (chunk) => {
        responseText += chunk
        setMessages((curr) =>
          curr.map((m) =>
            m.id === placeholder.id
              ? { ...m, content: responseText, pending: false, streaming: true }
              : m,
          ),
        )
      })
      await persistThreadMessage(threadId, 'assistant', responseText)
      setMessages((curr) =>
        curr.map((m) => (m.id === placeholder.id ? { ...m, pending: false, streaming: false } : m)),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg)
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
    if (t.title.trim().toLowerCase() === 'new chat') return false
    return !s || t.title.toLowerCase().includes(s)
  })

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
        window.alert('Copied')
        setTimeout(() => setCopied(false), 1800)
      } catch (error) {
        void error
      }
    }

    const elRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
      const el = elRef.current
      if (!el) return
      el.classList.add('msg-enter')
      requestAnimationFrame(() => el.classList.add('msg-enter-active'))
      const t = setTimeout(() => {
        el.classList.remove('msg-enter', 'msg-enter-active')
      }, 800)
      return () => clearTimeout(t)
    }, [])

    return (
      <article ref={elRef} className={cx('message-row', message.role === 'user' ? 'user' : 'assistant')}>
        {message.pending ? (
          <div className="avatar" aria-hidden>
            <span className="material-symbols-rounded" style={{ fontSize: 14 }}>smart_toy</span>
          </div>
        ) : null}

        <div className={cx('flex min-w-0 flex-col', message.role === 'user' ? 'items-end' : 'items-start')}>
          <div
            className={cx(
              'message-container max-w-[540px] text-xs leading-relaxed',
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
                {message.streaming && <span className="caret" aria-hidden />}
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
                    window.alert('Copied')
                    setTimeout(() => setCopied(false), 1400)
                  } catch (error) {
                    void error
                  }
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>content_copy</span>
              </button>

              <button className={cx('action-btn', liked && 'bg-[#c97a4b]/20')} title="Like" onClick={() => setLiked((s) => !s)}>
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
    <div className="w-full max-w-[560px] mx-auto">
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
        className="w-full max-w-[520px] mx-auto bg-white/[0.04] border border-white/[0.08] rounded-[36px] overflow-hidden flex-shrink-0 transition-all focus-within:border-[#c97a4b]/40 focus-within:[box-shadow:0_0_0_3px_rgba(201,122,75,0.08)]"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt"
          className="hidden"
          onChange={(event) => {
            const files = event.target.files
            if (!files?.length) return
            setError(`Selected ${files.length} file${files.length > 1 ? 's' : ''} to attach.`)
            event.target.value = ''
          }}
        />
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
          placeholder="Ask Maestro anything..."
          className="w-full bg-transparent px-3 pt-0.5 pb-0.5 text-xs outline-none resize-none text-[#f3efe7] placeholder:text-[#6b6560] min-h-[22px]"
        />
        <div className="flex items-center justify-between px-4 pb-1 gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-6 h-6 rounded-md bg-white/[0.05] border border-white/[0.08] flex items-center justify-center hover:bg-white/[0.1] transition-colors flex-shrink-0"
            aria-label="Add files"
            title="Add files"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24" }}
            >
              attach_file
            </span>
          </button>
          <button
            type="submit"
            disabled={isSending || isBootstrapping}
            className="w-6 h-6 rounded-md bg-[#c97a4b] text-[#100d0c] disabled:opacity-50 hover:bg-[#d4895c] transition-colors flex items-center justify-center flex-shrink-0"
            aria-label="Send message"
            title="Send message"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24" }}
            >
              {isSending ? 'hourglass_top' : 'send'}
            </span>
          </button>
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

      <aside className={cx(
        'bg-[#070708] border-r border-white/[0.04] p-4 h-screen overflow-y-auto',
        isMobileViewport && 'fixed left-0 top-0 z-30 w-72 transition-transform duration-200',
        isMobileViewport && (isSidebarOpen ? 'translate-x-0' : '-translate-x-full'),
        !isMobileViewport && 'flex-shrink-0 transition-[width] duration-200',
        !isMobileViewport && (isSidebarOpen ? 'w-72' : 'w-14'),
      )}>
        <div className={cx('flex items-center mb-6', isSidebarOpen ? 'gap-3' : 'justify-center')}>
          <button
            type="button"
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.06]"
            onClick={() => setIsSidebarOpen((s) => !s)}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>menu</span>
          </button>
          {isSidebarOpen && (
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={maestroLogo}
                alt="Maestro AI"
                className="h-5 w-5 rounded-lg object-cover flex-shrink-0 bg-white/5 shadow-lg"
              />
              <h1 className="text-xs font-semibold whitespace-nowrap truncate">Maestro AI</h1>
            </div>
          )}
        </div>

        {isSidebarOpen && (
          <div className="px-1">
            {primaryActions.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => item.label === 'New chat' && startNewChat()}
                className="flex items-center gap-3 w-full text-left px-3 py-2 rounded hover:bg-white/[0.02] text-xs text-[#cec5bc]"
              >
                <span className="material-symbols-rounded flex-shrink-0" style={{ fontSize: 14 }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}

        {isSidebarOpen && (
          <div className="px-1.5 mt-2">
            <label className="flex items-center gap-2 px-2.5 py-1.75 rounded-xl bg-white/[0.04] border border-white/[0.06] cursor-text">
              <span className="material-symbols-rounded text-[#8f877f]" style={{ fontSize: 13 }}>
                search
              </span>
              <input
                id="chat-search"
                type="search"
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                placeholder="Search chats"
                className="flex-1 bg-transparent border-none outline-none text-xs text-[#f3efe7] placeholder:text-[#8f877f]"
              />
            </label>
          </div>
        )}

        {isSidebarOpen && (
          <div className="px-1.5 mt-1.5">
            <div className="flex items-center gap-2 px-1.5 py-1 text-[#8f877f] text-xs font-semibold uppercase tracking-wide">
              <span className="material-symbols-rounded" style={{ fontSize: 12 }}>history</span>
              <span>Recents</span>
            </div>
            {filteredThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={cx(
                  'w-full text-left px-1 py-1.5 text-xs font-medium mb-0.5 transition-colors truncate whitespace-nowrap',
                  thread.id === activeThread.id ? 'text-[#f2b58b]' : 'text-[#a9a39c]',
                )}
                onClick={() => setActiveThreadId(thread.id)}
              >
                {thread.id === activeThreadId ? activeThreadTitle : thread.title}
              </button>
            ))}
            {filteredThreads.length === 0 && (
              <p className="px-1 py-1.5 text-xs text-[#6f6963]">No recent chats</p>
            )}
          </div>
        )}

        {isSidebarOpen && (
          <div className="flex flex-col gap-1.5 px-1.5 pt-2.5 pb-4 mt-2 border-t border-white/[0.06] w-full flex-shrink-0">
            <button
              type="button"
              className="flex items-center gap-2 px-1 py-1.5 text-xs font-semibold text-[#cec5bc] transition-colors"
              title="Settings"
            >
              <span className="material-symbols-rounded flex-shrink-0" style={{ fontSize: 14 }}>
                settings
              </span>
              <span>Settings</span>
            </button>

            <div className="flex items-center gap-2 px-1 py-1.5 text-[#f2b58b]">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="w-5 h-5 rounded-full flex-shrink-0 object-cover"
                />
              ) : (
                <span className="material-symbols-rounded flex-shrink-0" style={{ fontSize: 18 }}>
                  account_circle
                </span>
              )}
              <strong className="text-xs truncate">{user?.name ?? 'Maestro GPT'}</strong>
            </div>
          </div>
        )}
      </aside>

      <main className="flex w-full flex-1 min-w-0 flex-col overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-2.5 md:px-6 border-b border-white/[0.06] flex-shrink-0">
          {isMobileViewport && (
            <button
              type="button"
              className="w-7 h-7 inline-flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.06] flex-shrink-0"
              onClick={() => setIsSidebarOpen((s) => !s)}
              aria-label="Open menu"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>menu</span>
            </button>
          )}
          <div className="flex items-center gap-2 min-w-0 ml-auto">
            <h2 className="font-semibold text-xs truncate">{headerDisplayName}</h2>
            <button
              type="button"
              className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center hover:bg-white/[0.1] transition-colors flex-shrink-0"
              aria-label="Logout"
              onClick={logout}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24" }}
              >
                logout
              </span>
            </button>
          </div>
        </header>
        <div className={cx('flex-1 overflow-hidden flex flex-col p-4 md:p-6', hasConversation ? 'gap-4' : 'justify-center')}>
          {isWelcomeOnly && !input.trim() && (
            <div className="flex-1 min-h-0 flex items-center justify-center px-4 text-center">
              <div className="w-full max-w-[52rem] px-2 py-2 bg-transparent mb-2">
                <h2 className="mx-auto text-center text-base sm:text-base md:text-lg font-medium leading-snug text-[#f7f2ea] break-words mb-6">
                  {welcomeLine}
                </h2>
                {composerInner}
              </div>
            </div>
          )}

          {!isWelcomeOnly && hasConversation && (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
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
    </div>
  )
}

export default App
