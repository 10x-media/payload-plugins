import type { BootedPayload } from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'

const ORIGIN = 'http://localhost:3000'

type RequestOptions = {
	body?: unknown
	headers?: Record<string, string>
	signal?: AbortSignal
}

/**
 * Thin REST driver for SSE int tests. Uses `handleEndpoints` with the boot
 * cache key so registered root endpoints (including the stream) are exercised.
 */
export const createRestClient = (booted: BootedPayload) => {
	const request = async (method: string, path: string, options: RequestOptions = {}) => {
		const { body, headers = {}, signal } = options
		return handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`${ORIGIN}${path}`, {
				body: body === undefined ? undefined : JSON.stringify(body),
				headers: {
					...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
					...headers,
				},
				method,
				...(signal ? { signal } : {}),
			}),
		})
	}

	return {
		get: (path: string, options?: RequestOptions) => request('GET', path, options),
		post: (path: string, options?: RequestOptions) => request('POST', path, options),
		request,
	}
}

export const loginUser = async (
	booted: BootedPayload,
	email: string,
	password = 'test-pass-1234'
): Promise<string> => {
	await booted.payload.create({
		collection: 'users',
		data: { email, password },
	})
	const rest = createRestClient(booted)
	const res = await rest.post('/api/users/login', { body: { email, password } })
	const json = (await res.json()) as { token?: string }
	if (!json.token) {
		throw new Error(`login failed: ${res.status}`)
	}
	return json.token
}

export const openStream = async (args: {
	booted: BootedPayload
	token: string
	topics: string
	signal?: AbortSignal
	headers?: Record<string, string>
}): Promise<Response> => {
	const rest = createRestClient(args.booted)
	return rest.get(`/api/realtime/stream?topics=${encodeURIComponent(args.topics)}`, {
		headers: { Authorization: `JWT ${args.token}`, ...args.headers },
		signal: args.signal,
	})
}

export const readUntil = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	predicate: (buf: string) => boolean
): Promise<string> => {
	const decoder = new TextDecoder()
	let out = ''
	while (!predicate(out)) {
		const { done, value } = await reader.read()
		if (done) break
		out += decoder.decode(value, { stream: true })
	}
	return out
}
