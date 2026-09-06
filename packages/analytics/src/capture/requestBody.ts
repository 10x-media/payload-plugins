/** The subset of a Request the capped reader needs, so a PayloadRequest satisfies it. */
export interface CappedBodySource {
	headers: Headers
	body?: ReadableStream<Uint8Array> | null
	arrayBuffer?: () => Promise<ArrayBuffer>
}

/**
 * `too-large` is the caller's 413; `unreadable` is its 400. They are distinct because a
 * body that died in transit is the client's problem to retry, not a limit it exceeded.
 */
export type CappedBodyResult =
	| { ok: true; body: ArrayBuffer }
	| { ok: false; reason: 'too-large' | 'unreadable' }

const tooLarge = { ok: false, reason: 'too-large' } as const
const unreadable = { ok: false, reason: 'unreadable' } as const

const concat = (chunks: Uint8Array[], total: number): ArrayBuffer => {
	const out = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		out.set(chunk, offset)
		offset += chunk.byteLength
	}
	return out.buffer
}

/**
 * Buffers a request body, refusing anything over `maxBytes`. A declared `content-length`
 * short-circuits before a byte is read; a chunked body declares no length at all, so the
 * running total is checked per chunk and the read is cancelled the moment it passes the
 * cap. A stream that errors mid-read (a beacon from a tab that is already unloading is
 * routine, not exceptional) resolves as `unreadable` rather than throwing, which would
 * escape the handler into Payload's routeError as a 500.
 */
export const readCappedBody = async (
	req: CappedBodySource,
	maxBytes: number
): Promise<CappedBodyResult> => {
	const declared = req.headers.get('content-length')
	if (declared !== null) {
		const length = Number(declared)
		if (Number.isFinite(length) && length > maxBytes) {
			return tooLarge
		}
	}
	const stream = req.body
	if (!stream) {
		try {
			const buffered = (await req.arrayBuffer?.()) ?? new ArrayBuffer(0)
			return buffered.byteLength > maxBytes ? tooLarge : { ok: true, body: buffered }
		} catch {
			return unreadable
		}
	}
	const reader = stream.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) {
				break
			}
			total += value.byteLength
			if (total > maxBytes) {
				await reader.cancel()
				return tooLarge
			}
			chunks.push(value)
		}
	} catch {
		return unreadable
	}
	return { ok: true, body: concat(chunks, total) }
}
