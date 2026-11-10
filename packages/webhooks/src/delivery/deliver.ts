import {
	BLOCKED_AT_SOCKET,
	BlockedDestinationError,
	guardedDispatcher,
	isPrivateLiteral,
	transport,
} from './destination'

/** Max response-body characters retained for the delivery log. */
const MAX_RESPONSE_BODY = 2_000

export type DeliverArgs = {
	url: string
	body: string
	headers: Record<string, string>
	timeoutMs: number
	/** Refuse a destination that resolves to a non-public address, at the socket. */
	guarded: boolean
}

export type DeliverResult = {
	ok: boolean
	responseStatus?: number
	responseBody?: string
	error?: string
	durationMs: number
}

/**
 * Read at most `MAX_RESPONSE_BODY` characters of the response and drop the connection.
 *
 * `res.text()` would buffer the whole body first, and the body is whatever the far end chooses to
 * send: a receiver, or anything else an operator-supplied URL points at, could hand back hundreds
 * of megabytes inside the timeout, on every delivery.
 */
const readCapped = async (res: Awaited<ReturnType<typeof transport.fetch>>): Promise<string> => {
	const reader = res.body?.getReader()
	if (!reader) {
		return ''
	}
	const decoder = new TextDecoder()
	let text = ''
	while (text.length < MAX_RESPONSE_BODY) {
		const { done, value } = await reader.read()
		if (done) {
			break
		}
		text += decoder.decode(value, { stream: true })
	}
	await reader.cancel().catch(() => undefined)
	return text.slice(0, MAX_RESPONSE_BODY)
}

/**
 * POST `body` to `url` with a hard timeout; never throws.
 *
 * Redirects are not followed. A redirect would re-send the signed request, custom headers and
 * all, to an address the operator never entered, and following one is how a public URL reaches an
 * internal host. The 3xx is recorded as the failed delivery it is, so the fix is to enter the
 * final URL.
 *
 * With `guarded`, the socket's DNS lookup refuses any non-public address, so a public name cannot
 * be pointed at an internal host after it was saved. An address literal never reaches that lookup,
 * so it is judged here: the guard does not depend on a caller having checked the URL first.
 */
export const deliver = async (args: DeliverArgs): Promise<DeliverResult> => {
	if (args.guarded && URL.canParse(args.url) && isPrivateLiteral(args.url)) {
		return { ok: false, error: BLOCKED_AT_SOCKET, durationMs: 0 }
	}
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), args.timeoutMs)
	const start = Date.now()
	try {
		const res = await transport.fetch(args.url, {
			method: 'POST',
			headers: args.headers,
			body: args.body,
			redirect: 'manual',
			signal: controller.signal,
			...(args.guarded ? { dispatcher: guardedDispatcher() } : {}),
		})
		return {
			ok: res.ok,
			responseStatus: res.status,
			responseBody: await readCapped(res),
			durationMs: Date.now() - start,
		}
	} catch (err) {
		// A refusal from the guarded lookup arrives wrapped in undici's own "fetch failed".
		const cause = err instanceof Error ? err.cause : undefined
		const error =
			cause instanceof BlockedDestinationError
				? cause.message
				: err instanceof Error
					? err.message
					: String(err)
		return { ok: false, error, durationMs: Date.now() - start }
	} finally {
		clearTimeout(timer)
	}
}
