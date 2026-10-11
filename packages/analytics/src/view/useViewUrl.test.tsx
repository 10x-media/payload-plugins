import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from './state'
import { useViewUrl, type ViewUrl } from './useViewUrl'

const mocks = vi.hoisted(() => ({
	search: '',
	push: vi.fn<(url: string, options?: { scroll?: boolean }) => void>(),
	replace: vi.fn<(url: string) => void>(),
}))

vi.mock('next/navigation', () => ({
	usePathname: () => '/admin/analytics',
	useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
	useSearchParams: () => new URLSearchParams(mocks.search),
}))

const defaults = { range: 'last30days', metric: 'pageviews' } as const

const base: ViewState = {
	range: 'last30days',
	compare: false,
	metric: 'pageviews',
	tab: 'pages',
	filters: [],
	limit: 10,
}

let url: ViewUrl | null = null

const Probe = ({ scope }: { scope?: string }) => {
	url = useViewUrl({ defaults, scope })
	return null
}

beforeEach(() => {
	url = null
	mocks.search = ''
	mocks.push.mockReset()
	mocks.replace.mockReset()
	vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
	vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	vi.useRealTimers()
})

describe('useViewUrl', () => {
	it('reads the query string the router reports', () => {
		mocks.search = 'metric=visitors'
		render(<Probe />)
		expect(url?.search).toBe('metric=visitors')
	})

	it('pushes a step with the history API, never through the router', () => {
		render(<Probe />)
		url?.push({ ...base, metric: 'visitors' })
		expect(window.history.pushState).toHaveBeenCalledWith(
			null,
			'',
			'/admin/analytics?metric=visitors'
		)
		expect(mocks.push).not.toHaveBeenCalled()
	})

	it('writes the bare path for the default view', () => {
		mocks.search = 'metric=visitors'
		render(<Probe />)
		url?.push(base)
		expect(window.history.pushState).toHaveBeenCalledWith(null, '', '/admin/analytics')
	})

	it('pushes nothing for a step that changes nothing', () => {
		mocks.search = 'metric=visitors'
		render(<Probe />)
		url?.push({ ...base, metric: 'visitors' })
		expect(window.history.pushState).not.toHaveBeenCalled()
	})

	it('goes through the router only when the scope token changes, which the server resolves', () => {
		const { rerender } = render(<Probe />)
		url?.push({ ...base, scope: '*:alpha' })
		expect(mocks.push).toHaveBeenCalledWith('/admin/analytics?scope=*%3Aalpha', { scroll: false })
		expect(window.history.pushState).not.toHaveBeenCalled()

		mocks.search = 'scope=*%3Aalpha'
		rerender(<Probe scope="*:alpha" />)
		url?.push({ ...base, scope: '*:alpha', metric: 'visitors' })
		expect(window.history.pushState).toHaveBeenCalledWith(
			null,
			'',
			'/admin/analytics?scope=*%3Aalpha&metric=visitors'
		)
		url?.push(base)
		expect(mocks.push).toHaveBeenLastCalledWith('/admin/analytics', { scroll: false })
		expect(mocks.push).toHaveBeenCalledTimes(2)
	})

	it('replaces a correction after the router has had its turn, never through the router', async () => {
		mocks.search = 'source=retired'
		render(<Probe />)
		url?.replace('')
		expect(window.history.replaceState).not.toHaveBeenCalled()
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/admin/analytics')
		expect(mocks.replace).not.toHaveBeenCalled()
	})

	it('drops a correction cancelled before it was written, and one with nothing to correct', async () => {
		mocks.search = 'source=retired'
		render(<Probe />)
		const cancel = url?.replace('')
		cancel?.()
		url?.replace('source=retired')
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(window.history.replaceState).not.toHaveBeenCalled()
	})
})
