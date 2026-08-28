export type SseFrame = {
	event?: string
	data?: string
	id?: string
	retry?: number
}

/** Build the stream URL with `topics` as encodeURIComponent'd comma-separated values. */
export function buildStreamUrl(url: string, topics: string[]): string {
	const topicsParam = topics.map((t) => encodeURIComponent(t)).join(',')
	const separator = url.includes('?') ? '&' : '?'
	return `${url}${separator}topics=${topicsParam}`
}

/**
 * Incremental SSE text parser. Call `push` with decoded chunks; `onFrame` fires
 * for each complete event (blank-line terminated).
 */
export function createSseParser(onFrame: (frame: SseFrame) => void): {
	push(chunk: string): void
} {
	let buffer = ''
	let event: string | undefined
	let dataLines: string[] = []
	let id: string | undefined
	let retry: number | undefined

	const resetFields = () => {
		event = undefined
		dataLines = []
		id = undefined
		retry = undefined
	}

	const dispatch = () => {
		const hasPayload =
			event !== undefined || dataLines.length > 0 || id !== undefined || retry !== undefined
		if (!hasPayload) {
			resetFields()
			return
		}
		onFrame({
			event,
			data: dataLines.length > 0 ? dataLines.join('\n') : undefined,
			id,
			retry,
		})
		resetFields()
	}

	const processLine = (line: string) => {
		if (line.startsWith(':')) {
			return
		}
		if (line === '') {
			dispatch()
			return
		}
		const colon = line.indexOf(':')
		const field = colon === -1 ? line : line.slice(0, colon)
		let value = colon === -1 ? '' : line.slice(colon + 1)
		if (value.startsWith(' ')) {
			value = value.slice(1)
		}
		switch (field) {
			case 'event':
				event = value
				break
			case 'data':
				dataLines.push(value)
				break
			case 'id':
				id = value
				break
			case 'retry': {
				const ms = Number.parseInt(value, 10)
				if (!Number.isNaN(ms)) {
					retry = ms
				}
				break
			}
			default:
				break
		}
	}

	return {
		push(chunk: string) {
			buffer += chunk
			let newline = buffer.indexOf('\n')
			while (newline !== -1) {
				let line = buffer.slice(0, newline)
				buffer = buffer.slice(newline + 1)
				if (line.endsWith('\r')) {
					line = line.slice(0, -1)
				}
				processLine(line)
				newline = buffer.indexOf('\n')
			}
		},
	}
}
