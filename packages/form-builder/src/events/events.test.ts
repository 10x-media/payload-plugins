import { describe, expect, it } from 'vitest'
import { noopEventSink } from './noopSink'
import { resolveEventSink } from './resolveEventSink'

describe('event sink', () => {
	it('no-op sink accepts a submission.created event without throwing', async () => {
		await expect(
			noopEventSink.emit({
				type: 'submission.created',
				formId: 'f1',
				submissionId: 's1',
				at: '2026-01-01T00:00:00.000Z',
			})
		).resolves.toBeUndefined()
	})

	it('resolves to the no-op sink when none is provided', () => {
		expect(resolveEventSink(undefined)).toBe(noopEventSink)
	})
})
