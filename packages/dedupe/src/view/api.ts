'use client'

/** One fetch wrapper for the plugin's endpoints; the admin session cookie travels along. */
export const callApi = async <T>(args: {
	apiRoute: string
	path: string
	method?: 'GET' | 'POST'
	body?: unknown
}): Promise<T> => {
	const response = await fetch(`${args.apiRoute}${args.path}`, {
		method: args.method ?? 'GET',
		credentials: 'include',
		headers: args.body === undefined ? {} : { 'Content-Type': 'application/json' },
		body: args.body === undefined ? undefined : JSON.stringify(args.body),
	})
	const json = (await response.json().catch(() => ({}))) as { message?: string }
	if (!response.ok) {
		throw new Error(json.message ?? response.statusText)
	}
	return json as T
}

export const mergeUrl = (args: {
	mergePath: string
	collection: string
	/** The documents in the order the screen shows them; the first survives unless `survivor` says. */
	docs: string[]
	survivor?: string
}): string => {
	const query = new URLSearchParams({
		collection: args.collection,
		docs: args.docs.join(','),
		survivor: args.survivor ?? (args.docs[0] as string),
	})
	return `${args.mergePath}?${query.toString()}`
}

/**
 * One answer per question, shared for `ttl` milliseconds: callers asking the same thing at
 * nearly the same time share a request, a later caller asks again, since a document saved
 * in between changes the answer. A failed answer is forgotten at once.
 */
export const answerCache = <T>(ttl: number) => {
	const max = 50
	const entries = new Map<string, { at: number; answer: Promise<T> }>()
	return (key: string, ask: () => Promise<T>): Promise<T> => {
		const now = Date.now()
		const known = entries.get(key)
		if (known && now - known.at < ttl) return known.answer
		const answer = ask().catch((error: unknown) => {
			entries.delete(key)
			throw error
		})
		if (!known && entries.size >= max) entries.delete(entries.keys().next().value as string)
		entries.set(key, { at: now, answer })
		return answer
	}
}
