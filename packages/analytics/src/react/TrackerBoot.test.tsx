import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from '../capture/trackerConfig'
import type { TrackerEvent } from '../tracker/types'
import { TrackerBoot } from './TrackerBoot'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

const posted = (): TrackerEvent[] =>
	fetchMock.mock.calls.map(
		(call) =>
			JSON.parse((call as unknown as [string, RequestInit])[1].body as string) as TrackerEvent
	)

const nativeSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'native',
	adapterId: 'native',
	path: '/api/analytics/p/global',
	snippet: { scripts: [] },
	client: { kind: 'native' },
	requiresConsent: false,
}

const config: TrackerConfig = {
	slots: [nativeSlot],
	autoCapture: {
		scrollDepth: false,
		outboundLinks: false,
		fileDownloads: false,
		goalAttribute: false,
	},
	goals: [],
	ingestPath: '/api/analytics/ingest',
}

beforeEach(() => {
	fetchMock.mockClear()
	window.fetch = fetchMock as unknown as typeof fetch
	window.localStorage.clear()
})

afterEach(() => {
	cleanup()
})

describe('TrackerBoot', () => {
	it('renders nothing', () => {
		const { container } = render(<TrackerBoot config={config} />)

		expect(container.innerHTML).toBe('')
	})

	it('boots one tracker across re-renders', () => {
		const { rerender } = render(<TrackerBoot config={{ ...config }} />)
		rerender(<TrackerBoot config={{ ...config }} />)
		rerender(<TrackerBoot config={{ ...config }} />)

		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})

		expect(posted().filter((event) => event.type === 'pageview')).toHaveLength(1)
	})

	it('destroys its tracker on unmount', () => {
		const { unmount } = render(<TrackerBoot config={config} />)
		unmount()
		fetchMock.mockClear()

		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})

		expect(fetchMock).not.toHaveBeenCalled()
	})
})
