import { describe, expect, it, vi } from 'vitest'

import { startConsoleCapture } from './consoleCapture'

const fakeConsole = () => ({ error: vi.fn(), warn: vi.fn() })

describe('startConsoleCapture', () => {
	it('records errors and warnings and still calls the originals', () => {
		const target = fakeConsole()
		const { error, warn } = target
		const capture = startConsoleCapture({ console: target })
		target.error('boom', { code: 1 })
		target.warn('careful')
		const entries = capture.stop()
		expect(entries.map((entry) => [entry.level, entry.message])).toEqual([
			['error', 'boom {"code":1}'],
			['warn', 'careful'],
		])
		expect(error).toHaveBeenCalledWith('boom', { code: 1 })
		expect(warn).toHaveBeenCalledWith('careful')
	})

	it('restores the console on stop', () => {
		const target = fakeConsole()
		const original = target.error
		const capture = startConsoleCapture({ console: target })
		expect(target.error).not.toBe(original)
		capture.stop()
		expect(target.error).toBe(original)
	})

	it('caps the number and length of entries', () => {
		const target = fakeConsole()
		const capture = startConsoleCapture({ console: target })
		for (let index = 0; index < 80; index += 1) target.error('x'.repeat(900))
		const entries = capture.stop()
		expect(entries).toHaveLength(50)
		expect(entries[0]?.message).toHaveLength(500)
	})

	it('listens for uncaught errors and rejections on the window', () => {
		const listeners = new Map<string, (event: Event) => void>()
		const windowLike = {
			addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
				listeners.set(type, listener)
			}),
			removeEventListener: vi.fn(),
		}
		const capture = startConsoleCapture({
			console: fakeConsole(),
			window: windowLike as unknown as Window,
		})
		listeners.get('error')?.({ error: new Error('kaput') } as unknown as Event)
		listeners.get('unhandledrejection')?.({ reason: 'nope' } as unknown as Event)
		const entries = capture.stop()
		expect(entries[0]?.message).toContain('kaput')
		expect(entries[1]?.message).toBe('Unhandled rejection: nope')
		expect(windowLike.removeEventListener).toHaveBeenCalledTimes(2)
	})
})
