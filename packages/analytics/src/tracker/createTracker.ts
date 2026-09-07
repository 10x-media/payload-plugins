import type { TrackerConfig, TrackerSlotConfig } from '../capture/trackerConfig'
import { type AutoCapture, createAutoCapture } from './autoCapture'
import { createConsentQueue, readConsent, writeConsent } from './consent'
import { createScriptLoader } from './loadScript'
import { createPageTracking } from './pageTracking'
import { createNativeSink } from './sinks/native'
import { createPlausibleSink } from './sinks/plausible'
import { createPosthogSink } from './sinks/posthog'
import { createUmamiSink } from './sinks/umami'
import type {
	ConsentState,
	LoadScript,
	Sink,
	Tracker,
	TrackerEvent,
	TrackerOptions,
	TrackerWindow,
} from './types'

/** Stand-in for a host with no DOM (server rendering, a worker). Every call is a no-op. */
export const createNoopTracker = (): Tracker => ({
	page: () => undefined,
	track: () => undefined,
	trackGoal: () => undefined,
	consent: () => undefined,
	flush: () => undefined,
	destroy: () => undefined,
})

const buildSink = (args: {
	slot: TrackerSlotConfig
	win: TrackerWindow
	loadScript: LoadScript
	ingestPath: string
	scrollDepth: () => number | undefined
}): Sink => {
	const { slot, win, loadScript, ingestPath, scrollDepth } = args
	const vendor = { slot: slot.slot, win, scripts: slot.snippet.scripts, loadScript }
	switch (slot.kind) {
		case 'native':
			return createNativeSink({ slot: slot.slot, win, url: ingestPath, scrollDepth })
		case 'posthog':
			return createPosthogSink(vendor)
		case 'plausible':
			return createPlausibleSink(vendor)
		case 'umami':
			return createUmamiSink(vendor)
	}
}

/**
 * The browser tracker: one sink per capture slot, a consent gate in front of the slots the
 * server marked as gated, SPA page tracking, and the auto-capture listeners.
 *
 * Every event fans out to every slot; there is no dual-write of one slot's events into
 * another. The config is a server-rendered snapshot, so an unknown goal slug is still sent:
 * the server may know goals the snapshot predates.
 */
export const createTracker = (config: TrackerConfig, options: TrackerOptions = {}): Tracker => {
	const win = options.window ?? (globalThis as { window?: TrackerWindow }).window
	if (!win) {
		return createNoopTracker()
	}
	const persist = options.persistConsent !== false
	const loadScript = options.loadScript ?? createScriptLoader(win, options.nonce)
	const queue = createConsentQueue<{ sink: Sink; event: TrackerEvent }>()
	let auto: AutoCapture | null = null
	let state: ConsentState | null = persist ? readConsent(win) : null

	const entries = config.slots.map((slot) => ({
		requiresConsent: slot.requiresConsent,
		sink: buildSink({
			slot,
			win,
			loadScript,
			ingestPath: config.ingestPath,
			scrollDepth: () => auto?.scrollDepth(),
		}),
	}))

	const load = (sink: Sink) => {
		void sink.ready().catch(() => undefined)
	}

	const dispatch = (event: TrackerEvent) => {
		for (const entry of entries) {
			if (!entry.requiresConsent || state === 'granted') {
				entry.sink.send(event)
			} else if (state !== 'denied') {
				queue.push({ sink: entry.sink, event })
			}
		}
	}

	const context = (): Pick<TrackerEvent, 'path' | 'hostname' | 'referrer'> => ({
		path: win.location.pathname,
		hostname: win.location.hostname,
		...(win.document.referrer ? { referrer: win.document.referrer } : {}),
	})

	const page = () => {
		dispatch({ type: 'pageview', ...context() })
		auto?.resetPage()
	}

	const track = (name: string, props?: Record<string, unknown>) => {
		dispatch({ type: 'event', name, ...context(), ...(props ? { props } : {}) })
	}

	const trackGoal = (slug: string, opts?: { value?: number; currency?: string }) => {
		const goal = config.goals.find((candidate) => candidate.slug === slug)
		const value = opts?.value ?? goal?.value?.fixed
		const currency = opts?.currency ?? goal?.currency
		dispatch({
			type: 'goal',
			name: slug,
			...context(),
			...(value === undefined ? {} : { value }),
			...(currency === undefined ? {} : { currency }),
		})
	}

	const flush = () => {
		for (const entry of entries) {
			entry.sink.flush?.()
		}
	}

	auto = createAutoCapture({
		win,
		options: config.autoCapture,
		handlers: { track, trackGoal },
	})
	const pageTracking = createPageTracking(win, page)
	win.addEventListener('pagehide', flush)

	for (const entry of entries) {
		if (!entry.requiresConsent || state === 'granted') {
			load(entry.sink)
		}
	}
	page()

	return {
		page,
		track,
		trackGoal,
		flush,
		consent(next) {
			state = next
			if (persist) {
				writeConsent(win, next)
			}
			if (next === 'denied') {
				queue.clear()
				return
			}
			for (const entry of entries) {
				if (entry.requiresConsent) {
					load(entry.sink)
				}
			}
			for (const queued of queue.drain()) {
				queued.sink.send(queued.event)
			}
		},
		destroy() {
			flush()
			pageTracking.destroy()
			auto?.destroy()
			auto = null
			win.removeEventListener('pagehide', flush)
			queue.clear()
		},
	}
}
