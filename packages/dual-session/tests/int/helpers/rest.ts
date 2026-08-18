import type { BootedPayload } from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'

const ORIGIN = 'http://localhost:3000'

type RequestOptions = {
	body?: unknown
	/** Sent verbatim; overrides anything the jar would contribute. */
	cookie?: string
	headers?: Record<string, string>
	/** Skip the jar for this call, both reading and writing. */
	jar?: boolean
}

export type RestResponse<T = Record<string, unknown>> = {
	body: T
	setCookies: string[]
	status: number
}

/** `name=value; Path=/; Expires=...` -> `['name', 'value', expiresAtMs]`. */
const parseSetCookie = (raw: string) => {
	const [pair, ...attributes] = raw.split(';')
	const separator = pair?.indexOf('=') ?? -1
	if (!pair || separator === -1) {
		return null
	}

	const expiresAttribute = attributes
		.map((attribute) => attribute.trim())
		.find((attribute) => attribute.toLowerCase().startsWith('expires='))

	return {
		expiresAt: expiresAttribute
			? Date.parse(expiresAttribute.slice('expires='.length))
			: Number.NaN,
		name: pair.slice(0, separator).trim(),
		value: pair.slice(separator + 1).trim(),
	}
}

/**
 * Drives a booted Payload through its real REST router.
 *
 * The whole plugin rests on core behaviour that is not a public contract — that
 * collection-declared endpoints shadow the built-ins, and that a collection's own auth
 * strategies run before `local-jwt`. Calling `strategy.authenticate` or an endpoint
 * handler directly proves neither, so every routing-sensitive test goes through
 * `handleEndpoints` instead: the same entry point the Next route handler uses.
 *
 * The cookie jar makes a client behave like a browser, which is the only way to express
 * the case the plugin exists for: one visitor holding an admin session and a frontend
 * session at the same time.
 */
export const createRestClient = (booted: BootedPayload) => {
	const jar = new Map<string, string>()

	const request = async <T = Record<string, unknown>>(
		method: string,
		path: string,
		options: RequestOptions = {}
	): Promise<RestResponse<T>> => {
		const { body, cookie, headers = {}, jar: useJar = true } = options

		const cookieHeader =
			cookie ??
			(useJar && jar.size > 0
				? [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
				: undefined)

		const response = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`${ORIGIN}${path}`, {
				body: body === undefined ? undefined : JSON.stringify(body),
				headers: {
					...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
					...(cookieHeader ? { Cookie: cookieHeader } : {}),
					...headers,
				},
				method,
			}),
		})

		const setCookies = response.headers.getSetCookie()

		if (useJar) {
			for (const raw of setCookies) {
				const parsed = parseSetCookie(raw)
				if (!parsed) {
					continue
				}
				// An expiry in the past is a deletion, which is how logout clears its cookie.
				if (!Number.isNaN(parsed.expiresAt) && parsed.expiresAt <= Date.now()) {
					jar.delete(parsed.name)
				} else {
					jar.set(parsed.name, parsed.value)
				}
			}
		}

		return {
			body: (await response.json()) as T,
			setCookies,
			status: response.status,
		}
	}

	return {
		/** Cookie names the jar currently holds, sorted for stable assertions. */
		cookieNames: () => [...jar.keys()].sort(),
		get: <T = Record<string, unknown>>(path: string, options?: RequestOptions) =>
			request<T>('GET', path, options),
		jar,
		post: <T = Record<string, unknown>>(path: string, options?: RequestOptions) =>
			request<T>('POST', path, options),
		request,
		setCookie: (name: string, value: string) => jar.set(name, value),
	}
}

/** The cookie name a `Set-Cookie` header assigns, ignoring its attributes. */
export const cookieNameOf = (raw: string) => parseSetCookie(raw)?.name

/** Names of every cookie a response sets, in order. */
export const setCookieNames = (response: RestResponse<unknown>) =>
	response.setCookies.map(cookieNameOf)
