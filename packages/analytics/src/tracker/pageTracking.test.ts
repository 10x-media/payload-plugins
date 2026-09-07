import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPageTracking } from './pageTracking'

const teardowns: Array<() => void> = []

afterEach(() => {
	while (teardowns.length > 0) {
		teardowns.pop()?.()
	}
	window.history.replaceState(null, '', '/')
})

const start = (onChange: () => void) => {
	const tracking = createPageTracking(window, onChange)
	teardowns.push(() => tracking.destroy())
	return tracking
}

describe('createPageTracking', () => {
	it('fires once per pushState to a new path', () => {
		const onChange = vi.fn()
		start(onChange)

		window.history.pushState(null, '', '/pricing')
		expect(onChange).toHaveBeenCalledTimes(1)

		window.history.pushState(null, '', '/docs')
		expect(onChange).toHaveBeenCalledTimes(2)
	})

	it('ignores a navigation that keeps the same path', () => {
		const onChange = vi.fn()
		start(onChange)

		window.history.replaceState(null, '', '/?utm_source=x')
		window.history.pushState(null, '', '/#section')
		expect(onChange).not.toHaveBeenCalled()
	})

	it('fires on popstate to a different path', async () => {
		const onChange = vi.fn()
		start(onChange)

		window.history.pushState(null, '', '/pricing')
		expect(onChange).toHaveBeenCalledTimes(1)

		window.history.back()
		await vi.waitFor(() => {
			expect(onChange).toHaveBeenCalledTimes(2)
		})
		expect(window.location.pathname).not.toBe('/pricing')
	})

	it('restores the original history methods on destroy', () => {
		const pushState = window.history.pushState
		const replaceState = window.history.replaceState
		const onChange = vi.fn()
		const tracking = createPageTracking(window, onChange)

		expect(window.history.pushState).not.toBe(pushState)
		tracking.destroy()

		expect(window.history.pushState).toBe(pushState)
		expect(window.history.replaceState).toBe(replaceState)
		window.history.pushState(null, '', '/after-destroy')
		expect(onChange).not.toHaveBeenCalled()
	})

	it('leaves a wrapper someone else installed after us alone', () => {
		const original = window.history.pushState
		const tracking = createPageTracking(window, vi.fn())
		const ours = window.history.pushState
		const theirs = (...args: Parameters<History['pushState']>) => {
			ours.apply(window.history, args)
		}
		window.history.pushState = theirs
		teardowns.push(() => {
			window.history.pushState = original
		})

		tracking.destroy()

		expect(window.history.pushState).toBe(theirs)
	})

	it('keeps the history methods working', () => {
		start(vi.fn())
		window.history.pushState({ id: 7 }, '', '/pricing')

		expect(window.location.pathname).toBe('/pricing')
		expect(window.history.state).toEqual({ id: 7 })
	})
})
