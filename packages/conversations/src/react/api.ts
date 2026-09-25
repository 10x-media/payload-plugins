import type {
	ListResponse,
	MentionsResponse,
	MessageResponse,
	PollResponse,
	SubscribeResponse,
} from '../shared/wire'

/** Thrown for any non-2xx answer; `status` lets callers tell 403 from 404 from 500. */
export class ConversationsRequestError extends Error {
	status: number

	constructor(message: string, status: number) {
		super(message)
		this.name = 'ConversationsRequestError'
		this.status = status
	}
}

export type ListQuery = {
	after?: string
	around?: string
	before?: string
	channels: string[]
	key: string
	latest?: boolean
	limit?: number
	parent?: null | string
	updatedSince?: string
}

export type SendBody = {
	body?: unknown
	channel?: string
	clientId: string
	data?: unknown
	key: string
	parent?: null | string
	text?: string
	type?: string
}

export type ConversationsApi = ReturnType<typeof createApi>

const errorMessage = async (res: Response): Promise<string> => {
	try {
		const json = (await res.json()) as { errors?: Array<{ message?: string }>; message?: string }
		return json.errors?.[0]?.message ?? json.message ?? res.statusText
	} catch {
		return res.statusText
	}
}

/**
 * A thin client for one instance's endpoints. Cookies carry the session, so
 * it works in the admin and on a website served from the same origin; pass
 * `fetch` to add headers (an API key, a bearer token) elsewhere.
 */
export const createApi = ({
	apiRoute = '/api',
	fetch: fetcher = (input, init) => globalThis.fetch(input, init),
	instance,
	serverURL = '',
}: {
	apiRoute?: string
	fetch?: (input: string, init: RequestInit) => Promise<Response>
	instance: string
	serverURL?: string
}) => {
	const base = `${serverURL}${apiRoute}/conversations/${instance}`

	const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
		const res = await fetcher(`${base}${path}`, {
			credentials: 'include',
			...init,
			headers: {
				...(init.body ? { 'Content-Type': 'application/json' } : {}),
				...init.headers,
			},
		})
		if (!res.ok) {
			throw new ConversationsRequestError(await errorMessage(res), res.status)
		}
		return (await res.json()) as T
	}

	const json = (method: string, body: unknown): RequestInit => ({
		body: JSON.stringify(body),
		method,
	})

	return {
		base,
		delete: (id: number | string) =>
			request<Pick<MessageResponse, 'message' | 'root'>>(
				`/messages/${encodeURIComponent(String(id))}`,
				{ method: 'DELETE' }
			),
		/** An extension's endpoint: `<base>/<name><path>`. A `body` makes it a POST by default. */
		extension: <T>(name: string, path: string, init: { body?: unknown; method?: string } = {}) =>
			request<T>(
				`/${name}${path}`,
				init.body === undefined
					? { method: init.method ?? 'GET' }
					: json(init.method ?? 'POST', init.body)
			),
		edit: (id: number | string, body: { body?: unknown; text?: string }) =>
			request<MessageResponse>(`/messages/${encodeURIComponent(String(id))}`, json('PATCH', body)),
		list: (query: ListQuery) => {
			const params = new URLSearchParams()
			params.set('key', query.key)
			params.set('channel', query.channels.join(','))
			if (query.parent) params.set('parent', query.parent)
			if (query.limit) params.set('limit', String(query.limit))
			if (query.before) params.set('before', query.before)
			if (query.after) params.set('after', query.after)
			if (query.around) params.set('around', query.around)
			if (query.updatedSince) params.set('updatedSince', query.updatedSince)
			if (query.latest) params.set('latest', '1')
			return request<ListResponse>(`/messages?${params.toString()}`)
		},
		mentions: (query: { channel: string; key: string; q: string }, signal?: AbortSignal) =>
			request<MentionsResponse>(
				`/mentions?${new URLSearchParams({ channel: query.channel, key: query.key, q: query.q }).toString()}`,
				{ signal }
			),
		poll: (body: { since: string; tokens: string[] }) =>
			request<PollResponse>('/poll', json('POST', body)),
		read: (body: { at: string; channels?: string[]; key: string; thread?: string }) =>
			request<{ ok: true }>('/read', json('POST', body)),
		send: (body: SendBody) => request<MessageResponse>('/messages', json('POST', body)),
		subscribe: (keys: string[]) => request<SubscribeResponse>('/subscribe', json('POST', { keys })),
	}
}
