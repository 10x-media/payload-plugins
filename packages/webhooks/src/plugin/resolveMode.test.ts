import { describe, expect, it, vi } from 'vitest'
import { resolveMode } from './resolveMode'

describe('resolveMode', () => {
	const warn = () => undefined

	it('auto -> queue when a runner is detectable', () => {
		expect(resolveMode({ configured: 'auto', hasAutoRun: true, hasJobsPlugin: false, warn })).toBe(
			'queue'
		)
		expect(resolveMode({ configured: 'auto', hasAutoRun: false, hasJobsPlugin: true, warn })).toBe(
			'queue'
		)
	})

	it('auto -> inline when no runner', () => {
		expect(resolveMode({ configured: 'auto', hasAutoRun: false, hasJobsPlugin: false, warn })).toBe(
			'inline'
		)
	})

	it('honors forced modes', () => {
		expect(resolveMode({ configured: 'inline', hasAutoRun: true, hasJobsPlugin: true, warn })).toBe(
			'inline'
		)
		expect(resolveMode({ configured: 'queue', hasAutoRun: true, hasJobsPlugin: false, warn })).toBe(
			'queue'
		)
	})

	it('warns when queue is forced without a detectable runner', () => {
		const spy = vi.fn()
		expect(
			resolveMode({ configured: 'queue', hasAutoRun: false, hasJobsPlugin: false, warn: spy })
		).toBe('queue')
		expect(spy).toHaveBeenCalledOnce()
	})
})
