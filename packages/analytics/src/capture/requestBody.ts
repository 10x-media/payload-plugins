/** The subset of a Request the capped reader needs, so a PayloadRequest satisfies it. */
export interface CappedBodySource {
	headers: Headers
	body?: ReadableStream<Uint8Array> | null
	arrayBuffer?: () => Promise<ArrayBuffer>
}

/**
 * Buffers a request body, refusing anything over `maxBytes` with null so the caller can
 * answer 413. A declared `content-length` short-circuits before a byte is read; a chunked
 * body declares no length at all, so the running total is checked per chunk and the read
 * is cancelled the moment it passes the cap.
 */
export const readCappedBody = async (
	req: CappedBodySource,
	maxBytes: number
): Promise<ArrayBuffer | null> => {
	const declared = req.headers.get('content-length')
	if (declared !== null) {
		const length = Number(declared)
		if (Number.isFinite(length) && length > maxBytes) {
			return null
		}
	}
	const stream = req.body
	if (!stream) {
		const buffered = (await req.arrayBuffer?.()) ?? new ArrayBuffer(0)
		return buffered.byteLength > maxBytes ? null : buffered
	}
	const reader = stream.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) {
			break
		}
		total += value.byteLength
		if (total > maxBytes) {
			await reader.cancel()
			return null
		}
		chunks.push(value)
	}
	const out = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		out.set(chunk, offset)
		offset += chunk.byteLength
	}
	return out.buffer
}
