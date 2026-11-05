import { getAPIUrl } from '@services/config/config'
import type { AtlasPageContext, AtlasReference } from './types'

/** One rendered piece of a chat, as stored by the API (see services/ai/agent/runner.py). */
export type AtlasBlock =
  | { type: 'user'; text: string; references?: AtlasReference[] }
  | { type: 'text'; text: string }
  | {
      type: 'tool'
      id: string
      name: string
      args?: Record<string, unknown>
      status: 'running' | 'ok' | 'error' | 'awaiting'
      error?: string
      links?: AtlasLink[]
    }
  | ({ type: 'proposal' } & AtlasProposal)
  | { type: 'notice'; text: string }

export interface AtlasLink {
  label: string
  url: string
}

export interface AtlasProposal {
  id: string
  tool: string
  args?: Record<string, unknown>
  tier: 'create' | 'edit' | 'destructive' | 'read' | string
  target?: { kind?: string; uuid?: string; name?: string }
  summary: string
  requires_confirmation?: boolean
  status: 'pending' | 'applied' | 'cancelled' | 'failed'
  error?: string | null
  links?: AtlasLink[] | null
}

export interface AtlasSessionSummary {
  id: string
  title: string
  favorite: boolean
  created_at: string
  updated_at: string
}

export interface AtlasSession {
  id: string
  title: string
  favorite?: boolean
  transcript: AtlasBlock[]
}

export type AtlasStreamEvent =
  | { type: 'start'; session_id: string; title: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; args?: Record<string, unknown> }
  | { type: 'tool_end'; id: string; name: string; status: 'ok' | 'error' | 'awaiting'; error?: string; links?: AtlasLink[] }
  | { type: 'proposal'; proposal: AtlasProposal }
  | { type: 'done'; title: string }
  | { type: 'error'; message: string }

const base = () => `${getAPIUrl()}ai/agent`

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = typeof body?.detail === 'string' ? body.detail : detail
    } catch {
      /* not JSON */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export const atlasApi = {
  listSessions: (orgId: number, token: string) =>
    call<{ sessions: AtlasSessionSummary[] }>(`/sessions?org_id=${orgId}`, token).then((r) => r.sessions),

  createSession: (orgId: number, token: string) =>
    call<AtlasSession>(`/sessions?org_id=${orgId}`, token, { method: 'POST' }),

  getSession: (orgId: number, token: string, id: string) =>
    call<AtlasSession>(`/sessions/${id}?org_id=${orgId}`, token),

  patchSession: (orgId: number, token: string, id: string, patch: { title?: string; favorite?: boolean }) =>
    call<AtlasSessionSummary>(`/sessions/${id}?org_id=${orgId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteSession: (orgId: number, token: string, id: string) =>
    call<{ ok: boolean }>(`/sessions/${id}?org_id=${orgId}`, token, { method: 'DELETE' }),

  applyProposal: (orgId: number, token: string, id: string) =>
    call<AtlasProposal>(`/proposals/${id}/apply?org_id=${orgId}`, token, { method: 'POST' }),

  cancelProposal: (orgId: number, token: string, id: string) =>
    call<AtlasProposal>(`/proposals/${id}/cancel?org_id=${orgId}`, token, { method: 'POST' }),

  /** Send a message and call `onEvent` for every streamed event. Resolves when the turn ends. */
  async sendMessage(
    orgId: number,
    token: string,
    sessionId: string,
    body: { text: string; page_context?: AtlasPageContext | null; references?: AtlasReference[] },
    onEvent: (event: AtlasStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch(`${base()}/sessions/${sessionId}/messages?org_id=${orgId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`
      try {
        const json = await res.json()
        detail = typeof json?.detail === 'string' ? json.detail : detail
      } catch {
        /* not JSON */
      }
      throw new Error(detail)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() || ''
      for (const chunk of chunks) {
        const line = chunk.trim()
        if (!line.startsWith('data: ')) continue
        try {
          onEvent(JSON.parse(line.slice(6)) as AtlasStreamEvent)
        } catch {
          /* ignore a malformed event */
        }
      }
    }
  },
}
