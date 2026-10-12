import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../../translations/keys'
import { RealtimeStrip } from './RealtimeStrip'

vi.mock('@payloadcms/ui', () => ({
	ShimmerEffect: ({ className }: { className?: string }) => (
		<div aria-hidden="true" className={className} />
	),
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		<button onClick={onClick} type="button">
			{children}
		</button>
	),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const answer = (body: unknown, ok = true): Response =>
	Response.json(body, { status: ok ? 200 : 403 })

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const renderStrip = async () => {
	render(<RealtimeStrip endpoint="/api/_x/live" locale="en" sourceId="native" timezone="UTC" />)
	await act(async () => {})
}

describe('RealtimeStrip', () => {
	it('shows the counter once the first reading lands', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					answer({
						status: 'ok',
						activeNow: 7,
						series: [{ date: '2026-09-14T06:00:00.000Z', value: 7 }],
					})
				)
			)
		)
		await renderStrip()
		expect(document.querySelector('.analytics-widget__value')?.textContent).toBe('7')
		expect(screen.queryByText(keys.stateUnavailable)).toBeNull()
	})

	it('says the strip is unavailable when the first read is refused', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(answer({ error: 'forbidden' }, false)))
		)
		const { container } = render(
			<RealtimeStrip endpoint="/api/_x/live" locale="en" sourceId="native" timezone="UTC" />
		)
		await act(async () => {})
		expect(screen.getByText(keys.stateUnavailable)).toBeDefined()
		expect(container.querySelector('.analytics-view__skeleton')).toBeNull()
	})

	it('says a source that failed to count for now is busy, and reads again on retry', async () => {
		const fetchMock = vi.fn(() =>
			Promise.resolve(
				Response.json(
					{ error: { code: 'unavailable', message: 'busy' } },
					{ status: 503, headers: { 'Retry-After': '20' } }
				)
			)
		)
		vi.stubGlobal('fetch', fetchMock)
		const { container } = render(
			<RealtimeStrip endpoint="/api/_x/live" locale="en" sourceId="native" timezone="UTC" />
		)
		await act(async () => {})
		expect(screen.getByText(keys.viewErrorBusy)).toBeDefined()
		expect(screen.queryByText(keys.stateUnavailable)).toBeNull()
		expect(container.textContent).toContain(keys.viewErrorRetryAfter)
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: keys.viewRetry }))
		})
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it('says a network failure is busy for now too, never unavailable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(new Error('network down')))
		)
		const { container } = render(
			<RealtimeStrip endpoint="/api/_x/live" locale="en" sourceId="native" timezone="UTC" />
		)
		await act(async () => {})
		expect(screen.getByText(keys.viewErrorBusy)).toBeDefined()
		expect(container.querySelector('.analytics-view__skeleton')).toBeNull()
	})

	it('keeps the placeholder while the first read is in flight', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => {}))
		)
		const { container } = render(
			<RealtimeStrip endpoint="/api/_x/live" locale="en" sourceId="native" timezone="UTC" />
		)
		expect(container.querySelector('.analytics-view__skeleton')).not.toBeNull()
		expect(screen.queryByText(keys.stateUnavailable)).toBeNull()
	})
})
