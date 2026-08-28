import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RealtimeEvent } from '../broker/types'
import { encodeComment, encodeEvent, encodeRetry } from './encode'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('encodeRetry', () => {
	it('emits a retry frame with a trailing blank line', () => {
		expect(encodeRetry(3000)).toBe('retry: 3000\n\n')
	})
})

describe('encodeComment', () => {
	it('emits a heartbeat comment frame', () => {
		expect(encodeComment('heartbeat')).toBe(': heartbeat\n\n')
	})
})

describe('encodeEvent', () => {
	it('emits id, event, single data line, and a blank line for a thin event', () => {
		const event: RealtimeEvent = {
			id: 'evt-1',
			topic: 'posts',
			event: 'update',
			collection: 'posts',
			docId: '42',
			operation: 'update',
			timestamp: 1_700_000_000_000,
		}
		const json = JSON.stringify(event)
		expect(encodeEvent(event)).toBe(`id: evt-1\nevent: update\ndata: ${json}\n\n`)
	})

	it('splits data across multiple lines when JSON contains a newline', () => {
		const event: RealtimeEvent = {
			id: 'evt-2',
			topic: 'posts',
			event: 'create',
			timestamp: 1,
			data: { body: 'line1\nline2' },
		}
		// Default JSON.stringify escapes newlines in strings; pretty-print yields real
		// newlines so the SSE multi-line data: rule is observable.
		const json = JSON.stringify(event, null, 2)
		expect(json).toContain('\n')
		vi.spyOn(JSON, 'stringify').mockReturnValue(json)

		const dataLines = json
			.split('\n')
			.map((line) => `data: ${line}`)
			.join('\n')
		expect(encodeEvent(event)).toBe(`id: evt-2\nevent: create\n${dataLines}\n\n`)
	})

	it('strips CR/LF from id and event so they cannot inject a second data line', () => {
		const event: RealtimeEvent = {
			id: 'ts:posts:a\ndata: pwned:update:posts',
			topic: 'posts',
			event: 'update\ndata: injected',
			collection: 'posts',
			docId: 'a\ndata: pwned',
			operation: 'update',
			timestamp: 1,
		}
		const encoded = encodeEvent(event)
		expect(encoded.match(/^data: /gm)).toHaveLength(1)
		expect(encoded).not.toMatch(/\ndata: pwned/)
		expect(encoded).not.toMatch(/\ndata: injected/)
	})
})
