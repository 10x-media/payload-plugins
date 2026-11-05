import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import type { SlotWithoutConsent, TrackerConfig, TrackerSlotConfig } from './config'
import { createTracker } from './createTracker'
import { EXCLUSION_STORAGE_KEY } from './exclusion'
import { LEGACY_CONSENT_KEYS } from './gate'
import { PLAUSIBLE_IGNORE_KEY } from './sinks/plausible'
import type { LoadScript, Tracker, TrackerEvent, TrackerOptions } from './types'

/** Tracker behaviour under `capture.withoutConsent`: each slot's mode, and what it sends and stores. */

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

type Beacon = TrackerEvent & { m?: string }

const posted = (): Beacon[] =>
	fetchMock.mock.calls.map((call) => {
		const [, init] = call as unknown as [string, RequestInit]
		return JSON.parse(init.body as string) as Beacon
	})

const named = (beacons: Beacon[]) => beacons.map((beacon) => [beacon.name ?? beacon.type, beacon.m])

const COOKIELESS: SlotWithoutConsent = { pending: 'cookieless', refused: 'cookieless' }

const nativeSlot = (withoutConsent?: SlotWithoutConsent): TrackerSlotConfig => ({
	slot: 'global',
	kind: 'native',
	adapterId: 'native',
	path: '/api/_x/p/global',
	snippet: { scripts: [] },
	client: { kind: 'native' },
	gated: true,
	...(withoutConsent ? { withoutConsent } : {}),
})

const posthogSlot = (withoutConsent?: SlotWithoutConsent): TrackerSlotConfig => ({
	slot: 'tenant',
	kind: 'posthog',
	adapterId: 'posthog',
	path: '/api/_x/p/tenant',
	snippet: { scripts: [{ inline: 'posthog.init()' }] },
	client: { kind: 'posthog', token: 'phc_test' },
	gated: true,
	...(withoutConsent ? { withoutConsent } : {}),
})

const plausibleSlot = (withoutConsent?: SlotWithoutConsent): TrackerSlotConfig => ({
	slot: 'tenant',
	kind: 'plausible',
	adapterId: 'plausible',
	path: '/api/_x/p/tenant',
	snippet: { scripts: [{ src: '/api/_x/p/tenant/js/script.js' }] },
	client: { kind: 'plausible' },
	gated: true,
	...(withoutConsent ? { withoutConsent } : {}),
})

const configWith = (slots: TrackerSlotConfig[]): TrackerConfig => ({
	slots,
	autoCapture: {
		scrollDepth: false,
		outboundLinks: false,
		fileDownloads: false,
		goalAttribute: false,
		query: true,
		items: { impressions: false, clicks: false, pages: false },
	},
	goals: [],
	ingestPath: '/api/_x/e',
	skip: { automation: false, previews: true },
})

let loadScript: ReturnType<typeof vi.fn> & LoadScript
let posthog: {
	capture: MockInstance
	opt_in_capturing: MockInstance
	opt_out_capturing: MockInstance
}
let trackers: Tracker[]

const boot = (
	slots: TrackerSlotConfig[],
	options: Omit<TrackerOptions, 'window'> = {}
): Tracker => {
	const tracker = createTracker(configWith(slots), { window, loadScript, ...options })
	trackers.push(tracker)
	return tracker
}

const restoreFromCache = () => {
	window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
}

beforeEach(() => {
	fetchMock.mockClear()
	window.fetch = fetchMock as unknown as typeof fetch
	window.localStorage.clear()
	window.history.replaceState(null, '', '/pricing')
	loadScript = vi.fn(() => Promise.resolve()) as ReturnType<typeof vi.fn> & LoadScript
	posthog = {
		capture: vi.fn(),
		opt_in_capturing: vi.fn(),
		opt_out_capturing: vi.fn(),
	}
	Object.defineProperty(window, 'posthog', { value: posthog, configurable: true })
	trackers = []
})

afterEach(() => {
	for (const tracker of trackers) {
		tracker.destroy()
	}
	vi.restoreAllMocks()
})

describe('the mode of each slot', () => {
	it('follows the gate: its pending level, full on consent, its refused level after a refusal', () => {
		const tracker = boot([
			nativeSlot({ pending: 'cookieless', refused: 'anonymous' }),
			posthogSlot(),
		])
		expect(tracker.mode).toEqual({ global: 'cookieless', tenant: 'off' })
		tracker.setGate(true)
		expect(tracker.mode).toEqual({ global: 'full', tenant: 'full' })
		tracker.setGate(false)
		expect(tracker.mode).toEqual({ global: 'anonymous', tenant: 'off' })
		expect(tracker.gate).toEqual({ global: 'closed', tenant: 'closed' })
	})

	it('returns a held slot to its pending mode on a back/forward cache restore', () => {
		const tracker = boot([nativeSlot(COOKIELESS)])
		tracker.setGate(true)
		fetchMock.mockClear()
		restoreFromCache()
		expect(tracker.mode.global).toBe('cookieless')
		tracker.track('after_restore')
		expect(named(posted())).toEqual([['after_restore', 'c']])
	})
})

describe('a native slot counting without consent', () => {
	it('sends at once while pending, stamped cookieless, and in full once granted', () => {
		const tracker = boot([nativeSlot(COOKIELESS)])
		tracker.track('pending_event')
		tracker.setGate(true)
		tracker.track('granted_event')
		expect(named(posted())).toEqual([
			['pageview', 'c'],
			['pending_event', 'c'],
			['granted_event', undefined],
		])
	})

	it('drops to its refused level after a revoke, anonymous here', () => {
		const tracker = boot([nativeSlot({ pending: 'cookieless', refused: 'anonymous' })])
		tracker.setGate(true)
		tracker.setGate(false)
		tracker.track('revoked_event')
		expect(named(posted()).at(-1)).toEqual(['revoked_event', 'a'])
	})

	it('holds only while it sends nothing: waiting events go out at the refused level', () => {
		const tracker = boot([nativeSlot({ pending: 'off', refused: 'cookieless' })])
		tracker.track('waiting')
		expect(posted()).toEqual([])
		tracker.setGate(false)
		expect(named(posted())).toEqual([
			['pageview', 'c'],
			['waiting', 'c'],
		])
	})
})

describe('no storage before a slot runs in full', () => {
	let reads: MockInstance
	let writes: MockInstance
	let removals: MockInstance
	let cookieReads: MockInstance
	let cookieWrites: MockInstance

	beforeEach(() => {
		reads = vi.spyOn(Storage.prototype, 'getItem')
		writes = vi.spyOn(Storage.prototype, 'setItem')
		removals = vi.spyOn(Storage.prototype, 'removeItem')
		cookieReads = vi.spyOn(Document.prototype, 'cookie', 'get')
		cookieWrites = vi.spyOn(Document.prototype, 'cookie', 'set')
	})

	const touched = () =>
		[reads, writes, removals, cookieReads, cookieWrites].reduce(
			(count, spy) => count + spy.mock.calls.length,
			0
		)

	it('reads and writes nothing while cookieless or anonymous, through a refusal', () => {
		const tracker = boot([
			nativeSlot({ pending: 'cookieless', refused: 'anonymous' }),
			plausibleSlot(COOKIELESS),
		])
		tracker.track('pending_event')
		tracker.setGate(false)
		tracker.track('refused_event')
		expect(posted().length).toBeGreaterThan(0)
		expect(touched()).toBe(0)
		expect(tracker.excluded).toBe(false)
	})

	it('reads the exclusion flag and deletes the legacy key only once a slot runs in full', () => {
		const tracker = boot([nativeSlot(COOKIELESS)])
		expect(touched()).toBe(0)
		tracker.setGate(true)
		expect(reads).toHaveBeenCalledWith(EXCLUSION_STORAGE_KEY)
		expect(removals).toHaveBeenCalledWith(LEGACY_CONSENT_KEYS[0])
	})
})

describe('the exclusion flag', () => {
	it('is not honoured while a slot counts without consent, and is once one runs in full', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		const tracker = boot([nativeSlot(COOKIELESS)])
		tracker.track('staff_before_consent')
		expect(tracker.excluded).toBe(false)
		tracker.setGate(true)
		expect(tracker.excluded).toBe(true)
		tracker.track('staff_after_consent')
		expect(named(posted())).toEqual([
			['pageview', 'c'],
			['staff_before_consent', 'c'],
		])
	})
})

describe('a slot that sends nothing without consent', () => {
	it("expires an earlier page's GA4 cookies on a refusal, with no tag on this page", () => {
		// Stands in for the tag on an earlier, consented page.
		const setCookie = (value: string) => Reflect.set(document, 'cookie', value)
		setCookie('_ga=GA1.1.1.1; path=/')
		setCookie('_ga_AB12CD34=GS1.1.1; path=/')
		setCookie('kept=1; path=/')
		const tracker = boot([
			{
				...plausibleSlot(),
				kind: 'ga4',
				adapterId: 'ga4',
				client: { kind: 'ga4', measurementId: 'G-AB12CD34' },
			},
		])
		tracker.setGate(false)
		expect(loadScript).not.toHaveBeenCalled()
		expect(document.cookie).toBe('kept=1')
		setCookie('kept=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/')
	})

	it('hands a strict GA4 slot no goal once refused after a grant', () => {
		const gtag = vi.fn()
		Object.defineProperty(window, 'gtag', { value: gtag, configurable: true })
		const tracker = boot([
			{
				...plausibleSlot(),
				kind: 'ga4',
				adapterId: 'ga4',
				client: { kind: 'ga4', measurementId: 'G-AB12CD34' },
			},
		])
		tracker.setGate(true)
		tracker.trackGoal('book-demo')
		tracker.setGate(false)
		tracker.trackGoal('book-demo')
		const events = gtag.mock.calls.filter(([command]) => command === 'event')
		expect(events.map(([, name]) => name)).toEqual(['book_demo'])
		Reflect.deleteProperty(window, 'gtag')
	})

	it('sends nothing before consent and nothing after a refusal, as 1.0.0-beta.14', () => {
		const tracker = boot([nativeSlot(), plausibleSlot()])
		tracker.track('pending_event')
		tracker.setGate(false)
		tracker.track('refused_event')
		expect(posted()).toEqual([])
		expect(loadScript).not.toHaveBeenCalled()
		expect(tracker.mode).toEqual({ global: 'off', tenant: 'off' })
		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()
	})

	it('sends what waited on consent, in full', () => {
		const tracker = boot([nativeSlot()])
		tracker.track('waiting')
		tracker.setGate(true)
		expect(named(posted())).toEqual([
			['pageview', undefined],
			['waiting', undefined],
		])
	})
})

describe('vendor slots counting without consent', () => {
	it('load the snippet while pending, and switch PostHog on consent and on a revoke', async () => {
		const tracker = boot([posthogSlot(COOKIELESS)])
		await vi.waitFor(() => expect(loadScript).toHaveBeenCalledTimes(1))
		tracker.track('pending_event')
		expect(posthog.capture).toHaveBeenCalledWith('pending_event', {})
		tracker.setGate(false)
		expect(posthog.opt_out_capturing).not.toHaveBeenCalled()
		tracker.setGate(true)
		expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1)
		tracker.setGate(false)
		expect(posthog.opt_out_capturing).toHaveBeenCalledTimes(1)
	})

	it('leave a vendor running in full on a restore until the host answers again', () => {
		const tracker = boot([posthogSlot(COOKIELESS)])
		tracker.setGate(true)
		restoreFromCache()
		expect(tracker.mode.tenant).toBe('cookieless')
		expect(posthog.opt_out_capturing).not.toHaveBeenCalled()
		tracker.setGate(true)
		expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1)
		tracker.setGate(false)
		expect(posthog.opt_out_capturing).toHaveBeenCalledTimes(1)
	})

	it('leave Plausible counting after a refusal, setting no opt-out', () => {
		const tracker = boot([plausibleSlot(COOKIELESS)])
		tracker.setGate(true)
		tracker.setGate(false)
		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()
		expect(tracker.mode.tenant).toBe('cookieless')
	})
})

describe('the snippet variant a slot loads', () => {
	const COOKIELESS_INIT = { inline: 'posthog.init("cookieless")' }
	const FULL_INIT = { inline: 'posthog.init("full")' }
	const variants = (): TrackerSlotConfig => ({
		...posthogSlot(COOKIELESS),
		snippet: { scripts: [COOKIELESS_INIT] },
		fullSnippet: { scripts: [FULL_INIT] },
	})

	/** Stands in for `<AnalyticsScripts>` having rendered the script with the page. */
	const rendered = (text: string) => {
		const el = document.createElement('script')
		el.type = 'text/plain'
		el.textContent = text
		document.head.appendChild(el)
	}

	afterEach(() => {
		document.head.innerHTML = ''
	})

	const loaded = async () => {
		await vi.waitFor(() => expect(loadScript).toHaveBeenCalled())
		return loadScript.mock.calls.map(([script]) => script)
	}

	it('adopts the full variant the server rendered for a slot open at boot', async () => {
		rendered(FULL_INIT.inline)
		boot([variants()], { gate: true })
		expect(await loaded()).toEqual([FULL_INIT])
	})

	it('adopts the cookieless variant the server rendered, never adding the full one', async () => {
		rendered(COOKIELESS_INIT.inline)
		boot([variants()], { gate: true })
		expect(await loaded()).toEqual([COOKIELESS_INIT])
	})

	it('loads the variant its mode asks for when the page holds neither', async () => {
		boot([variants()], { gate: true })
		expect(await loaded()).toEqual([FULL_INIT])
		trackers.pop()?.destroy()
		loadScript.mockClear()
		boot([variants()])
		expect(await loaded()).toEqual([COOKIELESS_INIT])
	})
})
