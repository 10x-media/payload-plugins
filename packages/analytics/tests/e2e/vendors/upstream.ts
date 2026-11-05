import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { E2E_UPSTREAM_BASES } from '../../../dev/helpers/e2eVendors'
import { posthogStatic, type VendorScripts } from './scripts'

/** Which mocked vendor a request reached, by the base path its adapter's `host` names. */
export type UpstreamVendor = 'plausible' | 'umami' | 'posthog-global' | 'posthog-tenant'

/** One request the mock upstream received, through the plugin's capture proxy. */
export interface UpstreamRequest {
	vendor: UpstreamVendor
	method: string
	/** The path under the vendor's base, such as `/api/event` or `/static/array.js`. */
	path: string
	query: Record<string, string>
	/** What the browser sent, decoded from PostHog's compression; null for a body-less request. */
	body: unknown
	userAgent: string | null
	/** The client address the proxy forwarded, which cookieless hashing depends on. */
	forwardedFor: string | null
	at: number
}

const VENDOR_BASES: ReadonlyArray<readonly [UpstreamVendor, string]> = [
	['plausible', E2E_UPSTREAM_BASES.plausible],
	['umami', E2E_UPSTREAM_BASES.umami],
	['posthog-global', E2E_UPSTREAM_BASES.posthogGlobal],
	['posthog-tenant', E2E_UPSTREAM_BASES.posthogTenant],
]

/** The routes a test reads the log through; nothing under a vendor base. */
export const UPSTREAM_LOG_PATH = '/__requests'

/** posthog-js asks its host for these on load: no flags, and no remote config beyond the defaults. */
const POSTHOG_FLAGS = {
	featureFlags: {},
	featureFlagPayloads: {},
	errorsWhileComputingFlags: false,
	quotaLimited: [],
}

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
	const chunks: Buffer[] = []
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
	}
	return Buffer.concat(chunks)
}

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

/**
 * A body as posthog-js, Plausible and Umami send it: JSON, PostHog's gzip, or PostHog's
 * `data=<base64>` form. Anything else stays text.
 */
export const decodeBody = (raw: Buffer, query: Record<string, string>): unknown => {
	if (raw.length === 0) {
		return null
	}
	// posthog-js names gzip in the query on some transports and not on others; the magic bytes tell.
	if (query.compression === 'gzip-js' || (raw[0] === 0x1f && raw[1] === 0x8b)) {
		return parseJson(gunzipSync(raw).toString('utf8'))
	}
	const text = raw.toString('utf8')
	if (text.startsWith('data=')) {
		const data = new URLSearchParams(text).get('data') ?? ''
		const decoded =
			query.compression === 'base64' ? Buffer.from(data, 'base64').toString('utf8') : data
		return parseJson(decoded)
	}
	return parseJson(text)
}

interface Reply {
	status: number
	body: string | Buffer
	/** Default JSON. */
	type?: string
}

const JS = 'text/javascript; charset=utf-8'

const json = (status: number, body: unknown): Reply => ({
	status,
	body: typeof body === 'string' ? body : JSON.stringify(body),
})

const send = (res: ServerResponse, reply: Reply): void => {
	res.writeHead(reply.status, {
		'content-type': reply.type ?? 'application/json',
		'cache-control': 'no-store',
	})
	res.end(reply.body)
}

const isScriptName = (name: string): boolean => /^[\w.-]+\.js$/.test(name)

/** The adapters' own server-side reads (sync, the project check), which no browser sends. */
const isAdapterRead = (route: string): boolean =>
	route.startsWith('/api/') && route !== '/api/event' && route !== '/api/send'

interface VendorRequest {
	vendor: UpstreamVendor
	method: string
	route: string
}

const posthogReply = async ({ method, route }: VendorRequest): Promise<Reply | null> => {
	const file = route.startsWith('/static/') ? route.slice('/static/'.length) : ''
	if (method === 'GET' && isScriptName(file)) {
		const body = await posthogStatic(file)
		return body ? { status: 200, body, type: JS } : json(404, {})
	}
	if (/^\/(flags|decide)\/?$/.test(route)) {
		return json(200, POSTHOG_FLAGS)
	}
	if (/^\/api\/projects\/[^/]+\/?$/.test(route)) {
		// Cookieless server hash mode on, so the adapter's admin check has nothing to warn about.
		return json(200, { id: 1, cookieless_server_hash_mode: 1 })
	}
	if (/^\/(e|i\/v0\/e|batch|capture|track|engage|s)\/?$/.test(route)) {
		return json(200, { status: 1 })
	}
	return null
}

/** What each vendor answers: its real browser script, and the minimal reply its script expects. */
const answer = async (request: VendorRequest, scripts: VendorScripts): Promise<Reply> => {
	const { vendor, method, route } = request
	let reply: Reply | null = null
	if (vendor === 'plausible') {
		if (method === 'GET' && route.startsWith('/js/')) {
			reply = { status: 200, body: scripts.plausible, type: JS }
		} else if (route === '/api/event') {
			reply = { status: 202, body: 'ok', type: 'text/plain' }
		}
	} else if (vendor === 'umami') {
		if (method === 'GET' && route === '/script.js') {
			reply = { status: 200, body: scripts.umami, type: JS }
		} else if (route === '/api/send') {
			reply = json(200, {})
		}
	} else {
		reply = await posthogReply(request)
	}
	return reply ?? json(404, { error: 'not mocked' })
}

export interface Upstream {
	url: string
	close(): Promise<void>
}

/**
 * The mock every vendor adapter in the vendor e2e mode points at: it serves each vendor's real
 * browser script, so what lands in storage is the vendor's own doing, and logs every request.
 * `GET /__requests` reads the log, `DELETE /__requests` clears it.
 */
export const startUpstream = async (port: number, scripts: VendorScripts): Promise<Upstream> => {
	let log: UpstreamRequest[] = []
	const server = createServer((req, res) => {
		void (async () => {
			const url = new URL(req.url ?? '/', 'http://upstream.invalid')
			const method = req.method ?? 'GET'
			if (url.pathname === UPSTREAM_LOG_PATH) {
				if (method === 'DELETE') {
					log = []
					return send(res, { status: 204, body: '' })
				}
				return send(res, json(200, log))
			}
			if (url.pathname === '/__health') {
				return send(res, json(200, { ok: true }))
			}
			const base = VENDOR_BASES.find(([, prefix]) => url.pathname.startsWith(`${prefix}/`))
			if (!base) {
				return send(res, json(404, { error: 'no such vendor' }))
			}
			const [vendor, prefix] = base
			const route = url.pathname.slice(prefix.length)
			const query = Object.fromEntries(url.searchParams)
			const raw = await readBody(req)
			if (!isAdapterRead(route)) {
				log.push({
					vendor,
					method,
					path: route,
					query,
					body: decodeBody(raw, query),
					userAgent: req.headers['user-agent'] ?? null,
					forwardedFor: (req.headers['x-forwarded-for'] as string | undefined) ?? null,
					at: Date.now(),
				})
			}
			send(res, await answer({ vendor, method, route }, scripts))
		})().catch((err: unknown) => send(res, json(500, { error: String(err) })))
	})
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, '127.0.0.1', () => resolve())
	})
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	}
}
