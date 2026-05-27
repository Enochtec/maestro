type ApiResponse<T> = T

export async function apiFetch<T>(url: string, options: RequestInit): Promise<ApiResponse<T>> {
  let res: Response
  try {
    res = await fetch(url, options)
  } catch {
    throw new Error('Cannot reach the server. Make sure it is running.')
  }

  // 1xx responses are provisional and usually indicate a proxy/backend issue.
  if (res.status >= 100 && res.status < 200) {
    throw new Error('The server returned a temporary response. Please retry in a moment.')
  }

  // Read body as text first — never call .json() directly, it throws on empty bodies
  const text = await res.text()

  if (!text.trim()) {
    // Empty body
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
    return {} as T
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    // Non-JSON body (plain-text error from Express or a proxy)
    if (!res.ok) throw new Error(text.slice(0, 300) || `Request failed (${res.status})`)
    throw new Error(`Unexpected response from server (${res.status})`)
  }

  if (!res.ok) {
    const msg = typeof body.error === 'string' && body.error
      ? body.error
      : `Request failed (${res.status})`
    throw new Error(msg)
  }

  return body as T
}

