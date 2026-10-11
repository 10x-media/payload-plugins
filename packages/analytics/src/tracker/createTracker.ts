import { PURCHASE_GOAL_SLUG } from '../goals/constants'
import { sanitizeItems } from '../goals/items'
import { type AutoCapture, createAutoCapture, itemCaptureOf } from './autoCapture'
import type { TrackerConfig } from './config'
import { matchesDigest } from './digest'
import { createEngagement, msSince } from './engagement'
import { campaignFields, type ItemCall, itemFields, pageContext } from './events'
import {
	announceExclusion,
	exclusionLinkValueOf,
	forgetExclusionParam,
	readExclusion,
	takeStashedExclusion,
	writeExclusion,
} from './exclusion'
import {
	ALL_PENDING,
	createGate,
	createGateQueue,
	forgetLegacyConsent,
	type GateTransition,
	queueable,
} from './gate'
import { createItemCapture, type ItemCapture } from './itemCapture'
import { createScriptLoader } from './loadScript'
import { createPageTracking } from './pageTracking'
import { createSink } from './sinks/createSink'
import { inLivePreview, skipReason } from './skip'
import type {
	GateState,
	PurchaseInput,
	Tracker,
	TrackerEvent,
	TrackerOptions,
	TrackGoalOptions,
} from './types'
import { currentWindow } from './window'

/**
 * Development only: the call is dropped either way, and a silent no-op would read as a working
 * integration.
 */
const warnDropped = (message: string): void => {
	// biome-ignore lint/plugin: the bundler's own inlined build flag, in browser code with no env module
	if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
		return
	}
	console.warn(message)
}

const NEGATIVE_REVENUE =
	'analytics: purchase() ignored a negative amount. Refunds are recorded server-side, from the payment webhook, and the browser call never sends one.'

const BROWSER_REFUND =
	'analytics: refund() does nothing in the browser. A refund is recorded server-side, from the payment webhook: anything a public beacon could subtract from a revenue bucket, anyone could forge.'

/** Events held while the boot checks an exclusion link or the live preview, a moment at most. */
const HELD_LIMIT = 100

/** An event that could not be delivered when it was sent, and when that was on the page's clock. */
interface Waiting {
	event: TrackerEvent
	at: number
}

/** How a tracker puts its held slots back to pending after a back/forward cache restore. */
const restorers = new WeakMap<Tracker, (event: Event) => void>()

/**
 * Resets the tracker's held slots to pending for a `pageshow` that restored the page; a second call
 * for the same event does nothing, so the registry and the tracker may both listen.
 */
export const restoreGate = (tracker: Tracker, event: Event): void => {
	restorers.get(tracker)?.(event)
}

/** Stand-in for a host with no DOM (server rendering, a worker). Every call is a no-op. */
export const createNoopTracker = (): Tracker => ({
	page: () => undefined,
	track: () => undefined,
	trackGoal: () => undefined,
	purchase: () => undefined,
	refund: () => undefined,
	setGate: () => undefined,
	gate: ALL_PENDING,
	excluded: false,
	exclude: () => undefined,
	flush: () => undefined,
	destroy: () => undefined,
})

/**
 * The tracker of a page nobody should count: it sends and injects nothing, and its gate still
 * takes the host's answers, so a consent UI reads them back as on any other page.
 */
const createSkippedTracker = (config: TrackerConfig, boot: GateState | undefined): Tracker => {
	const gate = createGate(config.slots)
	if (boot !== undefined) {
		gate.answer(boot)
	}
	const tracker: Tracker = {
		...createNoopTracker(),
		setGate: (state) => {
			gate.answer(state)
		},
		get gate() {
			return gate.snapshot
		},
	}
	restorers.set(tracker, () => gate.reset())
	return tracker
}

/**
 * The browser tracker: one sink per slot behind a gate the host's consent manager answers, kept in
 * memory alone. No storage is touched before a slot opens, the exclusion link's own write aside.
 */
export const createTracker = (config: TrackerConfig, options: TrackerOptions = {}): Tracker => {
	const win = currentWindow(options.window)
	if (!win) {
		return createNoopTracker()
	}
	// A page nobody should count sends nothing and injects nothing; the link still leaves the address.
	if (skipReason(config, win) !== null) {
		takeStashedExclusion(win)
		if (config.exclusion) {
			forgetExclusionParam(win, config.exclusion.param)
		}
		return createSkippedTracker(config, options.gate)
	}
	const snippets = options.snippets !== false
	const loadScript = options.loadScript ?? createScriptLoader(win, options.nonce)
	let auto: AutoCapture | null = null
	/** False until the stored flag is read, which waits for the first slot to open. */
	let excluded = false
	/** Whether the stored flag was read, or made moot by an explicit exclusion on this page. */
	let flagKnown = false
	let legacyForgotten = false
	/** The page was opened with the link's `=0`: the browser is put back once the flag is read. */
	let putBack = false
	/**
	 * Events sent while the boot checks an exclusion token or the live preview, null otherwise:
	 * delivered once both checks pass, dropped when either fails.
	 */
	let held: Waiting[] | null = null
	let destroyed = false
	/** The page turned out to be the live preview: nothing more is sent, and the gate still answers. */
	let skipped = false

	const entries = config.slots.map((slot) => ({
		slot: slot.slot,
		kind: slot.kind,
		/** What waits while the slot's gate is pending, or while the page is only prerendered. */
		queue: createGateQueue<Waiting>(),
		/**
		 * Whether an opening or an explicit inclusion cleared this vendor's own opt-out on this page,
		 * which the slot's scripts having run then clears once more.
		 */
		lifted: false,
		/** Whether the slot was open on this page, so its script may be running whatever its gate says now. */
		ran: false,
		sink: createSink({ slot, win, loadScript, ingestPath: config.ingestPath, snippets }),
	}))

	type Entry = (typeof entries)[number]

	const gate = createGate(config.slots)

	const allowed = (entry: Entry): boolean => gate.status(entry.slot) === 'open'

	const live = (): boolean => !destroyed && !skipped

	const now = (): number => win.performance.now()

	/**
	 * A throwing vendor global or an unserializable event must not skip the other slots or escape into
	 * the host's click handler.
	 */
	const guard = (run: () => void) => {
		try {
			run()
		} catch {
			// Dropped, like every other delivery failure.
		}
	}

	let activation: (() => void) | null = null

	/**
	 * Whether the browser only prerenders the page, which a visitor may never open. Nothing loads,
	 * no vendor is called and no pageview is sent until it is shown, when what waited runs once.
	 */
	const waitUntilShown = (): boolean => {
		if (Reflect.get(win.document, 'prerendering') !== true) {
			return false
		}
		if (activation === null) {
			activation = () => {
				activation = null
				if (!live()) {
					return
				}
				for (const entry of entries) {
					if (allowed(entry)) {
						load(entry)
						drain(entry)
					}
				}
				page()
			}
			win.document.addEventListener('prerenderingchange', activation, { once: true })
		}
		return true
	}

	/**
	 * Injects the slot's scripts, then clears the vendor's opt-out once more when this page lifted
	 * it: a vendor whose snippet defines its global (PostHog) had none to clear before the snippet ran.
	 */
	const load = (entry: Entry) => {
		if (excluded || held !== null || !live() || waitUntilShown()) {
			return
		}
		entry.ran = true
		void entry.sink
			.ready()
			.then(() => {
				if (entry.lifted && !excluded && allowed(entry) && live()) {
					switchVendor(entry, false)
				}
			})
			.catch(() => undefined)
	}

	/** The event as sent, with how long it waited when it waited at all. */
	const aged = (event: TrackerEvent, at: number | undefined): TrackerEvent => {
		const ageMs = at === undefined ? 0 : msSince(win, at)
		return ageMs > 0 ? { ...event, ageMs } : event
	}

	/** Queues what the slot's queue may hold of the event, stamped with when it was first sent. */
	const hold = (entry: Entry, event: TrackerEvent, at: number | undefined) => {
		const waiting = queueable(event, entry.kind)
		if (waiting) {
			entry.queue.push({ event: waiting, at: at ?? now() })
		}
	}

	/** A vendor is called only once the page is shown, since calling it loads its script. */
	const deliver = (entry: Entry, event: TrackerEvent, at?: number) => {
		if (entry.kind !== 'native' && waitUntilShown()) {
			hold(entry, event, at)
			return
		}
		guard(() => entry.sink.send(aged(event, at)))
	}

	const drain = (entry: Entry) => {
		for (const { event, at } of entry.queue.drain()) {
			deliver(entry, event, at)
		}
	}

	/** `at` is when an event that waited was first sent; one delivered as it is sent has none. */
	const dispatch = (event: TrackerEvent, at?: number) => {
		if (!live()) {
			return
		}
		if (held !== null) {
			if (held.length < HELD_LIMIT) {
				held.push({ event, at: at ?? now() })
			}
			return
		}
		if (excluded) {
			return
		}
		for (const entry of entries) {
			const status = gate.status(entry.slot)
			if (status === 'open') {
				deliver(entry, event, at)
			} else if (status === 'pending') {
				hold(entry, event, at)
			}
		}
	}

	// Only the native sink counts what was seen, and only while it may be sent anything at all.
	const items: ItemCapture | null = itemCaptureOf(config.autoCapture).impressions
		? createItemCapture({ win, onFull: () => engagement.send() })
		: null

	const engagement = createEngagement({
		win,
		scrollDepth: () => auto?.scrollDepth(),
		takeImpressions: () => items?.take() ?? [],
		dispatch: (event) => dispatch(event),
	})

	/**
	 * Watches for items while a native slot may receive what it sees, and not otherwise: never
	 * while the browser is excluded, and never while that slot's gate is not open.
	 */
	const syncItems = () => {
		if (!items) {
			return
		}
		if (!excluded && entries.some((entry) => entry.kind === 'native' && allowed(entry))) {
			items.start()
		} else {
			items.stop()
		}
	}

	/** Nothing waits and nothing is measured: what an exclusion leaves of the open page. */
	const silence = () => {
		engagement.stop()
		items?.stop()
		for (const entry of entries) {
			entry.queue.clear()
		}
	}

	/**
	 * Whether this tracker sent its document's pageview: every later one is a single-page app's
	 * navigation, whose referrer is still the one the document was loaded with.
	 */
	let navigating = false

	const page = () => {
		// While the boot is still checking, its release tracks the page instead.
		if (!live() || held !== null || waitUntilShown()) {
			return
		}
		engagement.send()
		const view = { ...pageContext(win), ...campaignFields(win, config.autoCapture) }
		dispatch({
			type: 'pageview',
			...view,
			...(navigating ? { nav: 1 } : {}),
			...(config.autoCapture.scrollDepth ? { scrollDepth: 0 } : {}),
		})
		navigating = true
		auto?.resetPage()
		// Like time and scroll, items seen are counted again from the first pageview after an
		// exclusion is cleared, never from the middle of the page it was cleared on.
		items?.resetPage()
		syncItems()
		if (excluded) {
			engagement.stop()
		} else {
			engagement.start(view)
		}
	}

	const track = (name: string, props?: Record<string, unknown>, opts?: ItemCall) => {
		dispatch({
			type: 'event',
			name,
			...pageContext(win),
			...(props ? { props } : {}),
			...itemFields(opts),
		})
	}

	const trackGoal = (slug: string, opts?: TrackGoalOptions & ItemCall) => {
		const goal = config.goals.find((candidate) => candidate.slug === slug)
		const value = opts?.value ?? goal?.value?.fixed
		const currency = opts?.currency ?? goal?.currency
		dispatch({
			type: 'goal',
			name: slug,
			...pageContext(win),
			...(value === undefined ? {} : { value }),
			...(currency === undefined ? {} : { currency }),
			...itemFields(opts),
		})
	}

	const purchase = (input: PurchaseInput) => {
		// Not `< 0`, so NaN falls here too: refunds are server-side and ingest refuses a negative
		// amount, so sending one is a bug to hear about rather than a beacon to spend.
		if (!(input.value >= 0)) {
			warnDropped(NEGATIVE_REVENUE)
			return
		}
		const goal = input.goal ?? PURCHASE_GOAL_SLUG
		const lines = sanitizeItems(input.items)
		// The order id rides on its own field: native keeps a digest of it, and each vendor sink maps
		// it to that vendor's own field.
		dispatch({
			type: 'goal',
			name: goal,
			...pageContext(win),
			value: input.value,
			...(input.currency === undefined ? {} : { currency: input.currency }),
			...(input.orderId === undefined ? {} : { orderId: input.orderId }),
			...(lines === undefined ? {} : { items: lines }),
			...(input.props ? { props: input.props } : {}),
			...itemFields(input),
		})
	}

	const refund = () => {
		warnDropped(BROWSER_REFUND)
	}

	/** Sets or clears the vendor's own opt-out, noting whether this page lifted it. */
	const switchVendor = (entry: Entry, optOut: boolean) => {
		entry.lifted = !optOut
		guard(() => entry.sink.exclude?.(optOut))
	}

	/**
	 * Whether the slot's vendor script may be running: the slot is or was open on this page, or the
	 * host loads the vendor scripts itself.
	 */
	const mayRun = (entry: Entry, open: boolean): boolean => open || entry.ran || !snippets

	/**
	 * Mirrors the flag into each vendor's own opt-out, which is all a snippet the server rendered
	 * obeys. Clearing reaches only an open slot: putting a browser back must never undo a refusal.
	 */
	const syncVendors = (next: boolean) => {
		for (const entry of entries) {
			if (next || allowed(entry)) {
				switchVendor(entry, next)
			}
		}
	}

	/**
	 * Reads the exclusion flag and deletes beta.11's consent key, once a slot is open and never
	 * before. The link's `=0` clears the flag, and the vendors' switches, only when it was set.
	 */
	const touchStorage = () => {
		if (!legacyForgotten) {
			legacyForgotten = true
			forgetLegacyConsent(win)
		}
		if (flagKnown) {
			return
		}
		flagKnown = true
		const stored = readExclusion(win)
		if (putBack) {
			if (stored) {
				writeExclusion(win, false)
				syncVendors(false)
			}
			return
		}
		if (!stored) {
			return
		}
		excluded = true
		announceExclusion(true)
		silence()
		for (const entry of entries) {
			if (mayRun(entry, allowed(entry))) {
				switchVendor(entry, true)
			}
		}
	}

	/** Drops what waited, and puts the refusal to the vendor itself whenever its script may be running. */
	const close = (entry: Entry, from: GateTransition['from']) => {
		entry.queue.clear()
		entry.lifted = false
		if (mayRun(entry, from === 'open')) {
			switchVendor(entry, true)
		}
	}

	/**
	 * Clears the vendor's own switch unless the browser is excluded (a refusal on an earlier page may
	 * have set it), then injects the slot's snippet and sends what waited, in order.
	 */
	const open = (entry: Entry) => {
		touchStorage()
		if (!excluded) {
			switchVendor(entry, false)
		}
		load(entry)
		drain(entry)
	}

	const setGate = (state: GateState) => {
		if (destroyed) {
			return
		}
		const moved = gate.answer(state)
		if (skipped) {
			return
		}
		for (const { slot, from, to } of moved) {
			const entry = entries.find((candidate) => candidate.slot === slot)
			if (!entry) {
				continue
			}
			if (to === 'open') {
				open(entry)
			} else {
				close(entry, from)
			}
		}
		syncItems()
	}

	let restoredBy: Event | null = null

	/**
	 * A page restored from the back/forward cache may have been refused in another tab since: its
	 * held slots wait for the host to answer again, and what is sent meanwhile is queued.
	 */
	const restore = (event: Event) => {
		if (restoredBy === event || !live()) {
			return
		}
		restoredBy = event
		if (gate.reset()) {
			syncItems()
		}
	}

	const onPageShow = (event: PageTransitionEvent) => {
		if (event.persisted) {
			restore(event)
		}
	}

	auto = createAutoCapture({
		win,
		options: config.autoCapture,
		handlers: { track, trackGoal },
	})
	const pageTracking = createPageTracking(win, page)
	win.addEventListener('pageshow', onPageShow)

	let detached = false
	/** Every listener and history patch off, and nothing left waiting. */
	const detach = () => {
		if (detached) {
			return
		}
		detached = true
		if (activation !== null) {
			win.document.removeEventListener('prerenderingchange', activation)
			activation = null
		}
		win.removeEventListener('pageshow', onPageShow)
		engagement.destroy()
		items?.destroy()
		pageTracking.destroy()
		auto?.destroy()
		auto = null
		for (const entry of entries) {
			entry.queue.clear()
		}
	}

	const loadOpenSlots = () => {
		for (const entry of entries) {
			if (allowed(entry)) {
				load(entry)
			}
		}
	}

	/** The boot proper, once whatever the page was opened with is settled. */
	const start = () => {
		if (entries.some(allowed)) {
			touchStorage()
		}
		loadOpenSlots()
		page()
	}

	// Read only while links are handed out, and stripped from the address at once so no pageview or
	// copied link carries it; a server-rendered snippet may have stripped it already.
	const link = config.exclusion
	const stashed = takeStashedExclusion(win)
	const asked = link
		? exclusionLinkValueOf(stashed ?? new URLSearchParams(win.location.search).get(link.param))
		: null
	if (link) {
		forgetExclusionParam(win, link.param)
	}
	putBack = asked === 'include'
	const token = link && asked !== null && asked !== 'include' ? asked.token : null
	const shown = inLivePreview(config, win)
	// Nothing leaves the page until both are settled, so the first page a staff member opens the
	// link on is not counted, and neither is a preview while it is being recognised.
	if (token !== null || shown !== null) {
		held = []
	}
	// Before anything is delivered, so the boot pageview goes where the host's answer sends it.
	if (options.gate !== undefined) {
		setGate(options.gate)
	}
	if (held === null) {
		start()
	} else {
		void Promise.all([
			token !== null && link ? matchesDigest(win, token, link.tokenHash) : false,
			shown ?? false,
		]).then(([valid, preview]) => {
			const waiting = held ?? []
			held = null
			if (destroyed) {
				return
			}
			if (preview) {
				skipped = true
				detach()
				return
			}
			// The staff member's own link: the one write that needs no open slot.
			if (valid) {
				excluded = true
				flagKnown = true
				writeExclusion(win, true)
				syncVendors(true)
			}
			start()
			for (const { event, at } of waiting) {
				dispatch(event, at)
			}
		})
	}

	const tracker: Tracker = {
		page,
		track,
		trackGoal,
		purchase,
		refund,
		flush: () => engagement.send(),
		setGate,
		get gate() {
			return gate.snapshot
		},
		get excluded() {
			return excluded
		},
		exclude(next) {
			excluded = next
			flagKnown = true
			writeExclusion(win, next)
			if (!live()) {
				return
			}
			syncVendors(next)
			if (next) {
				silence()
				return
			}
			loadOpenSlots()
		},
		destroy() {
			if (destroyed) {
				return
			}
			engagement.send()
			destroyed = true
			held = null
			detach()
		},
	}
	restorers.set(tracker, restore)
	return tracker
}
