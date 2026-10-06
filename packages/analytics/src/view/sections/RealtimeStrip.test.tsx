import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../../translations/keys'
import { RealtimeStrip } from './RealtimeStrip'

vi.mock('@payloadcms/ui', () => ({
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const answer = (body: unknown, ok = true): Response =>
	({ ok, json: () => Promise.resolve(body) }) as Response

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const renderStrip = async () => {
	render(<RealtimeStrip apiRoute="/api" locale="en" sourceId="native" />)
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
		expect(screen.getByText('7')).toBeDefined()
		expect(screen.queryByText(keys.stateUnavailable)).toBeNull()
	})

	it('says the strip is unavailable when the first read is refused', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(answer({ error: 'forbidden' }, false)))
		)
		const { container } = render(<RealtimeStrip apiRoute="/api" locale="en" sourceId="native" />)
		await act(async () => {})
		expect(screen.getByText(keys.stateUnavailable)).toBeDefined()
		expect(container.querySelector('.analytics-view__skeleton')).toBeNull()
	})

	it('says the strip is unavailable when the first read fails outright', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(new Error('network down')))
		)
		const { container } = render(<RealtimeStrip apiRoute="/api" locale="en" sourceId="native" />)
		await act(async () => {})
		expect(screen.getByText(keys.stateUnavailable)).toBeDefined()
		expect(container.querySelector('.analytics-view__skeleton')).toBeNull()
	})

	it('keeps the placeholder while the first read is in flight', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => {}))
		)
		const { container } = render(<RealtimeStrip apiRoute="/api" locale="en" sourceId="native" />)
		expect(container.querySelector('.analytics-view__skeleton')).not.toBeNull()
		expect(screen.queryByText(keys.stateUnavailable)).toBeNull()
	})
})
