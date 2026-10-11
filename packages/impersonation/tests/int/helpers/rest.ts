import type { BootedPayload } from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'

const ORIGIN = 'http://localhost:3000'

type RequestOptions = {
	body?: unknown
	cookie?: string
	headers?: Record<string, string>
	jar?: boolean
}

export type RestResponse<T = Record<string, unknown>> = {
	body: T
	setCookies: string[]
	status: number
}

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
					host: 'localhost:3000',
					Origin: ORIGIN,
					'Sec-Fetch-Site': 'same-origin',
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
				if (!Number.isNaN(parsed.expiresAt) && parsed.expiresAt <= Date.now()) {
					jar.delete(parsed.name)
				} else {
					jar.set(parsed.name, parsed.value)
				}
			}
		}

		const text = await response.text()
		let parsed = {} as T

		if (text) {
			try {
				parsed = JSON.parse(text) as T
			} catch {
				throw new Error(
					`${method} ${path} answered ${response.status} with a non-JSON body: ${text.slice(0, 200)}`
				)
			}
		}

		return { body: parsed, setCookies, status: response.status }
	}

	return {
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

export const cookieNameOf = (raw: string) => parseSetCookie(raw)?.name
