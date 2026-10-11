import { act, cleanup, render } from '@testing-library/react'
import { StrictMode, useCallback, useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from '../tracker/config'
import {
	forgetWindowGate,
	liveTracker,
	setWindowGate,
	subscribeWindowGate,
	windowGateSnapshot,
} from '../tracker/registry'
import type { GateStatus, TrackerEvent } from '../tracker/types'
import { AnalyticsProvider } from './AnalyticsProvider'
import { useAnalytics } from './useAnalytics'

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
	path: '/api/_x/p/global',
	snippet: { scripts: [] },
	client: { kind: 'native' },
	gated: false,
}

const config: TrackerConfig = {
	slots: [nativeSlot],
	autoCapture: {
		scrollDepth: false,
		outboundLinks: false,
		fileDownloads: false,
		goalAttribute: false,
		query: false,
		items: { impressions: false, clicks: false, pages: false },
	},
	goals: [],
	ingestPath: '/api/_x/e',
}

const gatedConfig: TrackerConfig = { ...config, slots: [{ ...nativeSlot, gated: true }] }

const Signup = () => {
	const { track } = useAnalytics()
	useEffect(() => {
		track('signup', { plan: 'pro' })
	}, [track])
	return null
}

/** Lets the registry's deferred teardown macrotask run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
	fetchMock.mockClear()
	window.fetch = fetchMock as unknown as typeof fetch
	window.localStorage.clear()
})

afterEach(async () => {
	cleanup()
	await settle()
	forgetWindowGate(window)
})

describe('AnalyticsProvider', () => {
	it('gives children a tracker they can send events through', () => {
		render(
			<AnalyticsProvider config={config}>
				<Signup />
			</AnalyticsProvider>
		)

		expect(posted()).toEqual([
			expect.objectContaining({ type: 'pageview' }),
			expect.objectContaining({ type: 'event', name: 'signup', props: { plan: 'pro' } }),
		])
	})

	it('creates one tracker across re-renders', () => {
		const { rerender } = render(
			<AnalyticsProvider config={{ ...config }}>{null}</AnalyticsProvider>
		)
		rerender(<AnalyticsProvider config={{ ...config }}>{null}</AnalyticsProvider>)
		rerender(<AnalyticsProvider config={{ ...config }}>{null}</AnalyticsProvider>)

		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})

		expect(posted().filter((event) => event.type === 'pageview')).toHaveLength(1)
	})

	it('boots exactly one tracker under StrictMode', () => {
		let effectRuns = 0
		const Probe = () => {
			useEffect(() => {
				effectRuns += 1
			}, [])
			return null
		}
		render(
			<StrictMode>
				<AnalyticsProvider config={config}>
					<Probe />
				</AnalyticsProvider>
			</StrictMode>
		)

		// Guards the test itself: without a double-invoked mount there is nothing to prove.
		expect(effectRuns).toBe(2)
		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})
		expect(posted().filter((event) => event.type === 'pageview')).toHaveLength(1)
	})

	it('destroys the tracker on unmount', async () => {
		const { unmount } = render(<AnalyticsProvider config={config}>{null}</AnalyticsProvider>)
		unmount()
		await settle()
		fetchMock.mockClear()

		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('never boots a fresh tracker after its own unmount', async () => {
		const held: { api: ReturnType<typeof useAnalytics> | null } = { api: null }
		const Probe = () => {
			held.api = useAnalytics()
			return null
		}
		const { unmount } = render(
			<AnalyticsProvider config={config}>
				<Probe />
			</AnalyticsProvider>
		)
		unmount()
		await settle()
		fetchMock.mockClear()

		held.api?.track('late')

		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe('useAnalytics', () => {
	// Outside a provider the hook falls back to the window's booted tracker; with neither,
	// the call throws. `Signup` tracks from an effect, so render surfaces it.
	it('throws outside a provider when no tracker was booted either', () => {
		const onError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(() => render(<Signup />)).toThrow(/AnalyticsProvider/)

		onError.mockRestore()
	})

	it('exposes the tracker surface and nothing else', () => {
		let api: ReturnType<typeof useAnalytics> | null = null
		const Probe = () => {
			api = useAnalytics()
			return null
		}
		render(
			<AnalyticsProvider config={config}>
				<Probe />
			</AnalyticsProvider>
		)

		expect(Object.keys(api ?? {}).sort()).toEqual([
			'excluded',
			'gate',
			'purchase',
			'refund',
			'setExcluded',
			'setGate',
			'track',
			'trackGoal',
		])
	})

	it('opens a held slot from a child effect, which runs before the provider has booted', () => {
		const latest: { api: ReturnType<typeof useAnalytics> | null } = { api: null }
		const Gate = () => {
			const api = useAnalytics()
			latest.api = api
			const { setGate } = api
			useEffect(() => {
				setGate(true)
			}, [setGate])
			return null
		}
		render(
			<AnalyticsProvider config={gatedConfig}>
				<Gate />
				<Signup />
			</AnalyticsProvider>
		)

		expect(posted().map((event) => event.type)).toEqual(['pageview', 'event'])
		expect(latest.api?.gate.global).toBe('open')
		expect(Object.keys(window.localStorage)).toEqual([])
	})

	describe('a setGate from a child effect, which runs before the provider has booted', () => {
		const vendorConfig: TrackerConfig = {
			...config,
			slots: [
				{
					slot: 'tenant',
					kind: 'plausible',
					adapterId: 'plausible',
					path: '/api/_x/p/tenant',
					snippet: { scripts: [{ src: '/pl/script.js' }] },
					client: { kind: 'plausible' },
					gated: true,
				},
			],
		}
		const injected = () => document.head.querySelector('script[src="/pl/script.js"]')

		afterEach(() => {
			injected()?.remove()
		})

		const Bridge = ({ answer }: { answer: boolean }) => {
			const { setGate } = useAnalytics()
			useEffect(() => {
				setGate(answer)
			}, [setGate, answer])
			return null
		}

		it('boots under its answer, so a refusal sends no pageview the gate prop would have', () => {
			render(
				<AnalyticsProvider config={gatedConfig} gate={true}>
					<Bridge answer={false} />
				</AnalyticsProvider>
			)

			expect(fetchMock).not.toHaveBeenCalled()
		})

		it('boots under its answer, so a refusal loads no vendor an earlier answer had opened', async () => {
			act(() => {
				setWindowGate(true)
			})
			render(
				<AnalyticsProvider config={vendorConfig}>
					<Bridge answer={false} />
				</AnalyticsProvider>
			)

			await settle()
			expect(injected()).toBeNull()
		})
	})

	it('boots with the gate it is handed, and re-renders the caller when it changes', () => {
		const latest: { api: ReturnType<typeof useAnalytics> | null } = { api: null }
		const Probe = () => {
			latest.api = useAnalytics()
			return null
		}
		render(
			<AnalyticsProvider config={gatedConfig} gate={{ global: false }}>
				<Probe />
			</AnalyticsProvider>
		)
		expect(latest.api?.gate.global).toBe('closed')
		expect(fetchMock).not.toHaveBeenCalled()

		act(() => {
			latest.api?.setGate(true)
		})

		expect(latest.api?.gate.global).toBe('open')
		act(() => {
			latest.api?.track('signup')
		})
		expect(posted().map((event) => event.name)).toEqual(['signup'])
	})
})

describe("the consent page's c15t bridge on a page restored from the back/forward cache", () => {
	/** `useConsentManager()` from `@c15t/nextjs/headless`, as far as the bridge reads it. */
	interface ConsentManager {
		consents: Record<string, boolean>
		hasConsented(): boolean
		isLoadingConsentInfo: boolean
	}

	let manager: ConsentManager
	const useConsentManager = (): ConsentManager => manager

	/** The recipe's bridge as the docs print it, braces aside. */
	const AnalyticsGate = () => {
		const { consents, hasConsented, isLoadingConsentInfo } = useConsentManager()
		const { setGate } = useAnalytics()
		const opened = useRef(false)
		const granted = consents.measurement === true
		const decided = hasConsented()
		const answer = useCallback(() => {
			if (isLoadingConsentInfo) {
				return
			}
			if (granted) {
				opened.current = true
				setGate(true)
			} else if (decided || opened.current) {
				opened.current = false
				setGate(false)
			}
		}, [isLoadingConsentInfo, granted, decided, setGate])
		useEffect(() => answer(), [answer])
		useEffect(() => {
			const restored = (event: PageTransitionEvent) => {
				if (event.persisted) {
					answer()
				}
			}
			window.addEventListener('pageshow', restored)
			return () => window.removeEventListener('pageshow', restored)
		}, [answer])
		return null
	}

	const sentNames = () => posted().map((event) => event.name ?? event.type)

	/**
	 * Listens after the registry's restore and before the bridge mounts its own listener, so it sees
	 * the restored page between the reset and the bridge's answer, and sends an event right there.
	 */
	let stopProbe = (): void => undefined

	const probeRestore = () => {
		const seen: { gate?: GateStatus; sent?: string[] } = {}
		const probe = (event: PageTransitionEvent) => {
			if (event.persisted) {
				seen.gate = windowGateSnapshot(window).global
				liveTracker(window)?.track('restored')
				seen.sent = sentNames()
			}
		}
		subscribeWindowGate(() => undefined, window)
		window.addEventListener('pageshow', probe)
		stopProbe = () => window.removeEventListener('pageshow', probe)
		return seen
	}

	const restore = () => {
		act(() => {
			window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
		})
	}

	afterEach(() => {
		stopProbe()
	})

	beforeEach(() => {
		manager = {
			consents: { measurement: true },
			hasConsented: () => true,
			isLoadingConsentInfo: false,
		}
	})

	it('holds what the restored page sends until the bridge answers again, then sends it', () => {
		const seen = probeRestore()
		render(
			<AnalyticsProvider config={gatedConfig}>
				<AnalyticsGate />
			</AnalyticsProvider>
		)
		expect(sentNames()).toEqual(['pageview'])

		restore()

		expect(seen).toEqual({ gate: 'pending', sent: ['pageview'] })
		expect(sentNames()).toEqual(['pageview', 'restored'])
		expect(windowGateSnapshot(window).global).toBe('open')
	})

	it('closes the restored page again on the refusal c15t holds, dropping what waited', () => {
		manager = { ...manager, consents: { measurement: false } }
		const seen = probeRestore()
		render(
			<AnalyticsProvider config={gatedConfig}>
				<AnalyticsGate />
			</AnalyticsProvider>
		)

		restore()

		expect(seen.gate).toBe('pending')
		expect(windowGateSnapshot(window).global).toBe('closed')
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
