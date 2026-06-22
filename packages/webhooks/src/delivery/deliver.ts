/** Max response-body characters retained for the delivery log. */
const MAX_RESPONSE_BODY = 2_000

export type DeliverArgs = {
	url: string
	body: string
	headers: Record<string, string>
	timeoutMs: number
}

export type DeliverResult = {
	ok: boolean
	responseStatus?: number
	responseBody?: string
	error?: string
	durationMs: number
}

/** POST `body` to `url` with a hard timeout; never throws. */
export const deliver = async (args: DeliverArgs): Promise<DeliverResult> => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), args.timeoutMs)
	const start = Date.now()
	try {
		const res = await fetch(args.url, {
			method: 'POST',
			headers: args.headers,
			body: args.body,
			signal: controller.signal,
			redirect: 'error',
		})
		const text = await res.text()
		return {
			ok: res.ok,
			responseStatus: res.status,
			responseBody: text.slice(0, MAX_RESPONSE_BODY),
			durationMs: Date.now() - start,
		}
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - start,
		}
	} finally {
		clearTimeout(timer)
	}
}
