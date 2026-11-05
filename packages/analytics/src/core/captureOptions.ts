import { DEFAULT_PROXY_MAX_BODY_BYTES, DEFAULT_PROXY_TIMEOUT_MS } from '../capture/proxyEndpoint'
import { resolveAllowedOrigins } from '../capture/requestTrust'
import { CAPTURE_SLOTS, isCaptureSlot } from '../capture/slots'
import {
	CONSENT_PHASES,
	slotWithoutConsent,
	WITHOUT_CONSENT_LEVELS,
} from '../capture/withoutConsent'
import { isTrustedPlatform } from '../net/platform'
import type { CaptureSlot, ConsentPhase, TrackerSkip, WithoutConsentLevel } from '../tracker/config'
import {
	DEFAULT_AUTO_CAPTURE,
	DEFAULT_ITEM_CAPTURE,
	NO_ITEM_CAPTURE,
	type ResolvedAutoCapture,
	type ResolvedItemCapture,
} from '../tracker/config'
import { DEFAULT_EXCLUSION_PARAM } from '../tracker/exclusion'
import { DEFAULT_TRACKER_SKIP } from '../tracker/skip'
import type { AnalyticsAdapter } from './contract'
import { keysOf, optionalBoolean, optionsObject, positiveWhole } from './optionChecks'
import type {
	AnalyticsCaptureOptions,
	AnalyticsExclusionOptions,
	AnalyticsPluginOptions,
	AutoCaptureOptions,
	CaptureGatePolicy,
	ExclusionSitesResolver,
	ItemCaptureOptions,
	ResolvedCapture,
	ResolvedOptions,
	ResolvedWithoutConsent,
} from './options'
import { siteAddress } from './siteAddress'
import { assertNamesAdapter } from './sourceOptions'
import { isOneOf, kindOf } from './values'

const CAPTURE_KEYS = keysOf<AnalyticsCaptureOptions>({
	gate: true,
	withoutConsent: true,
	allowedOrigins: true,
	exclusion: true,
	slots: true,
	paths: true,
	autoCapture: true,
	skip: true,
	proxy: true,
})
const SLOT_KEYS = keysOf<NonNullable<AnalyticsCaptureOptions['slots']>>({
	global: true,
	tenant: true,
})
const PROXY_KEYS = keysOf<NonNullable<AnalyticsCaptureOptions['proxy']>>({
	timeoutMs: true,
	maxBodyBytes: true,
})
const AUTO_CAPTURE_FLAGS = [
	'scrollDepth',
	'outboundLinks',
	'fileDownloads',
	'goalAttribute',
	'query',
] as const
const AUTO_CAPTURE_KEYS = keysOf<AutoCaptureOptions>({
	scrollDepth: true,
	outboundLinks: true,
	fileDownloads: true,
	goalAttribute: true,
	query: true,
	items: true,
})
const ITEM_CAPTURE_KEYS = keysOf<ItemCaptureOptions>({
	impressions: true,
	clicks: true,
	pages: true,
})
const EXCLUSION_KEYS = keysOf<AnalyticsExclusionOptions>({ param: true, sites: true })

/** Unreserved URL characters, so the copied link needs no escaping. */
const EXCLUSION_PARAM_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/

const GATE_REQUIRED =
	"analytics: capture.gate is required: 'all' holds every slot until your consent manager calls setGate, 'off' captures without a gate, or list the slots that wait. The plugin does not decide which tracking needs consent."

/**
 * The capture slots that can fill on this config, as far as config time can see; a scoped install's
 * tenant slot counts whenever runtime providers could bring a capture adapter.
 */
export const fillableSlots = (options: AnalyticsPluginOptions, scoped: boolean): CaptureSlot[] => {
	const slots = options.capture?.slots
	const adapters = options.adapters
	const fillable: CaptureSlot[] = []
	if (slots?.global !== false) {
		const id =
			slots?.global ??
			options.platformAdapter ??
			(adapters.length === 1 ? adapters[0]?.id : undefined)
		if (adapters.some((adapter) => adapter.id === id && adapter.capture !== undefined)) {
			fillable.push('global')
		}
	}
	const providers =
		Boolean(options.providers?.collection) || options.providers?.resolve !== undefined
	if (
		scoped &&
		slots?.tenant !== false &&
		(providers || adapters.some((adapter) => adapter.capture !== undefined))
	) {
		fillable.push('tenant')
	}
	return fillable
}

/**
 * A function's answer gates its slot unless it is exactly `false`, so a gate that forgets to
 * return holds the slot rather than capturing without consent.
 */
const resolveGate = (
	option: AnalyticsCaptureOptions['gate'],
	required: boolean
): CaptureGatePolicy => {
	if (option === undefined) {
		if (required) {
			throw new Error(GATE_REQUIRED)
		}
		return () => true
	}
	if (option === 'all') {
		return () => true
	}
	if (option === 'off') {
		return () => false
	}
	if (Array.isArray(option)) {
		for (const slot of option) {
			if (typeof slot !== 'string' || !isCaptureSlot(slot)) {
				throw new Error(
					`analytics: capture.gate lists ${kindOf(slot)}, which is not a capture slot ('global' or 'tenant')`
				)
			}
		}
		const gated = new Set<CaptureSlot>(option)
		return ({ slot }) => gated.has(slot)
	}
	if (typeof option === 'function') {
		return (args) => option(args) !== false
	}
	throw new Error(
		`analytics: capture.gate must be 'all', 'off', a list of slots or a function, got ${kindOf(option)}`
	)
}

const isLevel = (value: unknown): value is WithoutConsentLevel =>
	isOneOf(WITHOUT_CONSENT_LEVELS, value)

const resolveWithoutConsent = (
	option: AnalyticsCaptureOptions['withoutConsent']
): ResolvedWithoutConsent | undefined => {
	if (option === undefined || typeof option === 'function') {
		return option
	}
	if (isLevel(option)) {
		return { pending: option, refused: option }
	}
	const phases = optionsObject(option, {
		path: 'capture.withoutConsent',
		known: CONSENT_PHASES,
		example: "'cookieless', 'off', an object such as { refused: 'off' } or a function",
	})
	const level = (phase: ConsentPhase): WithoutConsentLevel => {
		const value = phases[phase]
		if (value === undefined) {
			return 'cookieless'
		}
		if (!isLevel(value)) {
			throw new Error(
				`analytics: capture.withoutConsent.${phase} must be 'cookieless' or 'off', got ${kindOf(value)}`
			)
		}
		return value
	}
	return { pending: level('pending'), refused: level('refused') }
}

/** Slots the gate may hold, judged without calling host code: a function may hold either. */
const heldAtBoot = (gate: AnalyticsCaptureOptions['gate']): ReadonlySet<CaptureSlot> =>
	new Set(gate === 'off' ? [] : Array.isArray(gate) ? gate : CAPTURE_SLOTS)

/**
 * Whether a source following `capture.withoutConsent` may count without consent: unless the option
 * is `'off'` in both phases, since a function may answer `'cookieless'`.
 */
export const followingCountsWithoutConsent = (
	option: ResolvedWithoutConsent | undefined
): boolean =>
	typeof option === 'function' ||
	CONSENT_PHASES.some((phase) => (option?.[phase] ?? 'cookieless') !== 'off')

/** What the boot knows about which config adapter fills which slot; a resolved install is one. */
export interface BootFill {
	adapters: readonly AnalyticsAdapter[]
	platformAdapter?: string
	scoped: boolean
	capture: Pick<ResolvedCapture, 'slots' | 'heldSlots' | 'withoutConsent'>
}

/** Whether a config adapter may fill `slot`, as far as the boot can tell without a request. */
const fillsAtBoot = (fill: BootFill, slot: CaptureSlot, adapterId: string): boolean => {
	const configured = fill.capture.slots[slot]
	if (configured === false) {
		return false
	}
	if (slot === 'tenant') {
		return fill.scoped && (configured === undefined || configured === adapterId)
	}
	const only = fill.adapters.length === 1 ? fill.adapters[0]?.id : undefined
	return (configured || fill.platformAdapter || only) === adapterId
}

/**
 * Whether a config adapter may count without consent in a slot the gate holds, judged at boot
 * without calling a host function: a `capture.withoutConsent` function may answer `'cookieless'`.
 */
export const adapterCountsWithoutConsent = (fill: BootFill, adapter: AnalyticsAdapter): boolean => {
	const capture = adapter.capture
	if (!capture) {
		return false
	}
	const option = fill.capture.withoutConsent
	const answered = typeof option === 'function' ? () => 'cookieless' as const : option
	return CAPTURE_SLOTS.some(
		(slot) =>
			fill.capture.heldSlots.has(slot) &&
			fillsAtBoot(fill, slot, adapter.id) &&
			slotWithoutConsent({
				slot,
				adapterId: adapter.id,
				kind: capture.client.kind,
				capture,
				option: answered,
			}) !== undefined
	)
}

/**
 * Whether a held tenant slot may fall to a runtime provider document's adapter: with providers on,
 * unless the slot names a config adapter.
 */
export const documentsFillHeldTenant = (
	fill: Pick<BootFill, 'adapters' | 'scoped' | 'capture'>,
	providersOn: boolean
): boolean => {
	const configured = fill.capture.slots.tenant
	return (
		providersOn &&
		fill.scoped &&
		configured !== false &&
		fill.capture.heldSlots.has('tenant') &&
		!fill.adapters.some((adapter) => adapter.id === configured)
	)
}

const resolveItemCapture = (option: AutoCaptureOptions['items']): ResolvedItemCapture =>
	option === false
		? { ...NO_ITEM_CAPTURE }
		: {
				impressions: option?.impressions ?? DEFAULT_ITEM_CAPTURE.impressions,
				clicks: option?.clicks ?? DEFAULT_ITEM_CAPTURE.clicks,
				pages: option?.pages ?? DEFAULT_ITEM_CAPTURE.pages,
			}

const resolveAutoCapture = (option: AutoCaptureOptions | undefined): ResolvedAutoCapture => ({
	scrollDepth: option?.scrollDepth ?? DEFAULT_AUTO_CAPTURE.scrollDepth,
	outboundLinks: option?.outboundLinks ?? DEFAULT_AUTO_CAPTURE.outboundLinks,
	fileDownloads: option?.fileDownloads ?? DEFAULT_AUTO_CAPTURE.fileDownloads,
	goalAttribute: option?.goalAttribute ?? DEFAULT_AUTO_CAPTURE.goalAttribute,
	query: option?.query ?? DEFAULT_AUTO_CAPTURE.query,
	items: resolveItemCapture(option?.items),
})

/**
 * The auto-capture the tracker is handed: item capture off while no collection is bound as items,
 * since ingest would drop every ref it sent, so no page runs an observer for them.
 */
export const trackerAutoCapture = (
	autoCapture: ResolvedAutoCapture,
	itemsBound: boolean
): ResolvedAutoCapture => (itemsBound ? autoCapture : { ...autoCapture, items: NO_ITEM_CAPTURE })

/** A list checked once at boot; a function's answer is checked per request, by the endpoint. */
const resolveExclusionSites = (
	option: AnalyticsExclusionOptions['sites']
): ExclusionSitesResolver | undefined => {
	if (option === undefined) {
		return undefined
	}
	if (typeof option === 'function') {
		return option
	}
	const invalid: unknown = Array.isArray(option)
		? option.find((site) => siteAddress(site) === null)
		: option
	if (!Array.isArray(option) || invalid !== undefined) {
		throw new Error(
			`analytics: capture.exclusion.sites must be a function or a list of http(s) addresses such as 'https://shop.example.com', got ${kindOf(invalid)}`
		)
	}
	const sites = option.flatMap((site) => {
		const address = siteAddress(site)
		return address === null ? [] : [address]
	})
	return () => sites
}

const resolveExclusion = (
	option: AnalyticsCaptureOptions['exclusion']
): ResolvedCapture['exclusion'] => {
	if (option === undefined || option === false) {
		return false
	}
	if (option === true) {
		return { param: DEFAULT_EXCLUSION_PARAM }
	}
	optionsObject(option, {
		path: 'capture.exclusion',
		known: EXCLUSION_KEYS,
		example: "true, false or an object such as { param: 'staff' }",
	})
	const param = option.param ?? DEFAULT_EXCLUSION_PARAM
	if (typeof param !== 'string' || !EXCLUSION_PARAM_PATTERN.test(param)) {
		throw new Error(
			`analytics: capture.exclusion.param must be 1 to 64 letters, digits, ".", "_", "~" or "-", got ${kindOf(param)}`
		)
	}
	const sites = resolveExclusionSites(option.sites)
	return sites ? { param, sites } : { param }
}

const resolveSkip = (option: AnalyticsCaptureOptions['skip']): TrackerSkip => {
	if (option === undefined) {
		return { ...DEFAULT_TRACKER_SKIP }
	}
	const shaped = optionsObject(option, {
		path: 'capture.skip',
		known: Object.keys(DEFAULT_TRACKER_SKIP),
		example: 'an object such as { automation: false }',
	})
	const flag = (key: keyof TrackerSkip): boolean =>
		optionalBoolean(shaped[key], `capture.skip.${key}`) ?? DEFAULT_TRACKER_SKIP[key]
	return { automation: flag('automation'), previews: flag('previews') }
}

/** Each of `capture.slots` or `capture.paths`, checked by `valid` and refused with `expected`. */
const assertPerSlot = (
	value: unknown,
	at: { path: string; example: string; expected: string; valid: (entry: unknown) => boolean }
): void => {
	if (value === undefined) {
		return
	}
	const perSlot = optionsObject(value, { path: at.path, known: SLOT_KEYS, example: at.example })
	for (const [slot, entry] of Object.entries(perSlot)) {
		if (entry !== undefined && !at.valid(entry)) {
			throw new Error(`analytics: ${at.path}.${slot} must be ${at.expected}, got ${kindOf(entry)}`)
		}
	}
}

/** `capture` and the objects inside it whose values are read as they are. */
const assertCaptureShape = (option: AnalyticsCaptureOptions | undefined): void => {
	if (option === undefined) {
		return
	}
	optionsObject(option, {
		path: 'capture',
		known: CAPTURE_KEYS,
		example: "an object such as { gate: 'off' }",
	})
	assertPerSlot(option.slots, {
		path: 'capture.slots',
		example: "an object such as { global: 'native' }",
		expected: 'an adapter id or false',
		valid: (entry) => entry === false || typeof entry === 'string',
	})
	assertPerSlot(option.paths, {
		path: 'capture.paths',
		example: "an object such as { global: '/stats' }",
		expected: 'a path starting with "/", such as "/stats"',
		valid: (entry) => typeof entry === 'string' && entry.startsWith('/'),
	})
	if (option.proxy !== undefined) {
		optionsObject(option.proxy, {
			path: 'capture.proxy',
			known: PROXY_KEYS,
			example: 'an object such as { timeoutMs: 10000 }',
		})
	}
	if (option.autoCapture === undefined) {
		return
	}
	const auto = optionsObject(option.autoCapture, {
		path: 'capture.autoCapture',
		known: AUTO_CAPTURE_KEYS,
		example: 'an object such as { scrollDepth: true }',
	})
	for (const flag of AUTO_CAPTURE_FLAGS) {
		optionalBoolean(auto[flag], `capture.autoCapture.${flag}`)
	}
	if (auto.items !== undefined && auto.items !== false) {
		const items = optionsObject(auto.items, {
			path: 'capture.autoCapture.items',
			known: ITEM_CAPTURE_KEYS,
			example: 'false, or an object such as { clicks: false }',
		})
		for (const flag of ITEM_CAPTURE_KEYS) {
			optionalBoolean(items[flag], `capture.autoCapture.items.${flag}`)
		}
	}
}

/**
 * `capture` checked and filled. A global slot's adapter id is checked against `adapters` here; a
 * tenant one may name a runtime provider instance, which only exists once a scope resolves.
 */
export const resolveCapture = (
	options: AnalyticsPluginOptions,
	scoped: boolean
): ResolvedCapture => {
	const option = options.capture
	assertCaptureShape(option)
	const globalSlot = option?.slots?.global
	if (typeof globalSlot === 'string') {
		assertNamesAdapter(globalSlot, 'capture.slots.global', options.adapters ?? [])
	}
	const gate = resolveGate(option?.gate, fillableSlots(options, scoped).length > 0)
	const withoutConsent = resolveWithoutConsent(option?.withoutConsent)
	const fill: BootFill = {
		adapters: options.adapters ?? [],
		...(options.platformAdapter ? { platformAdapter: options.platformAdapter } : {}),
		scoped,
		capture: {
			slots: { global: globalSlot, tenant: option?.slots?.tenant },
			heldSlots: heldAtBoot(option?.gate),
			...(withoutConsent === undefined ? {} : { withoutConsent }),
		},
	}
	const providersOn =
		Boolean(options.providers?.collection) || options.providers?.resolve !== undefined
	return {
		...fill.capture,
		paths: { global: option?.paths?.global, tenant: option?.paths?.tenant },
		gate,
		installCountsWithoutConsent:
			fill.adapters.some((adapter) => adapterCountsWithoutConsent(fill, adapter)) ||
			(documentsFillHeldTenant(fill, providersOn) && followingCountsWithoutConsent(withoutConsent)),
		autoCapture: resolveAutoCapture(option?.autoCapture),
		proxy: {
			timeoutMs: positiveWhole(
				option?.proxy?.timeoutMs,
				'capture.proxy.timeoutMs',
				DEFAULT_PROXY_TIMEOUT_MS
			),
			maxBodyBytes: positiveWhole(
				option?.proxy?.maxBodyBytes,
				'capture.proxy.maxBodyBytes',
				DEFAULT_PROXY_MAX_BODY_BYTES
			),
		},
		allowedOrigins: resolveAllowedOrigins(option?.allowedOrigins),
		exclusion: resolveExclusion(option?.exclusion),
		skip: resolveSkip(option?.skip),
	}
}

/** Where the client address and location come from: a proxy count, a platform, or neither. */
export const resolveTrust = (
	options: AnalyticsPluginOptions
): Pick<ResolvedOptions, 'trustedProxyHops' | 'trustedPlatform'> => {
	const hops = options.trustedProxyHops
	if (hops !== undefined && (!Number.isInteger(hops) || hops < 0)) {
		throw new Error(
			`analytics: trustedProxyHops must be a non-negative integer, got ${String(hops)}`
		)
	}
	const platform: unknown = options.trustedPlatform
	if (platform !== undefined && !isTrustedPlatform(platform)) {
		throw new Error(
			`analytics: trustedPlatform must be 'vercel' or 'cloudflare', got ${kindOf(platform)}`
		)
	}
	if (hops !== undefined && platform !== undefined) {
		throw new Error(
			'analytics: trustedProxyHops and trustedPlatform cannot both be set. trustedPlatform reads the visitor address from the platform header, trustedProxyHops from x-forwarded-for: keep the one that describes what sits in front of the app.'
		)
	}
	return {
		...(hops === undefined ? {} : { trustedProxyHops: hops }),
		...(platform === undefined ? {} : { trustedPlatform: platform }),
	}
}

/**
 * The production boot notice for an install reading visitor addresses and countries from headers
 * nothing vouches for, or null.
 */
export const untrustedAddressNotice = (
	resolved: Pick<
		ResolvedOptions,
		'trustedProxyHops' | 'trustedPlatform' | 'adapters' | 'providers'
	>,
	production: boolean
): string | null => {
	if (
		!production ||
		resolved.trustedProxyHops !== undefined ||
		resolved.trustedPlatform !== undefined
	) {
		return null
	}
	const reads =
		resolved.providers.collection.enabled ||
		resolved.providers.resolve !== undefined ||
		resolved.adapters.some(
			(adapter) => adapter.ingest !== undefined || (adapter.capture?.proxy.routes.length ?? 0) > 0
		)
	return reads
		? "analytics: visitor IP addresses and countries can be spoofed on this install. Neither trustedProxyHops nor trustedPlatform is set, so the plugin reads them from request headers a visitor can write. Set trustedPlatform to 'vercel' or 'cloudflare' when the app runs behind one, or trustedProxyHops to the number of proxies in front of it."
		: null
}

/**
 * The boot line for an install leaving `capture.withoutConsent` unset while a held slot may count
 * without consent, naming the default in effect; null otherwise.
 */
export const withoutConsentUnsetNotice = (
	resolved: Pick<ResolvedOptions, 'capture'>
): string | null =>
	resolved.capture.withoutConsent === undefined && resolved.capture.installCountsWithoutConsent
		? "analytics: capture.withoutConsent is unset, so held slots measure cookielessly before consent and after a refusal. Set it to 'off' to send nothing without consent."
		: null

/**
 * The production boot warning for a held slot counting without consent while nothing says where
 * the client address comes from, or null: cookieless counting tells visitors apart by its hash.
 */
export const cookielessTrustNotice = (
	resolved: Pick<ResolvedOptions, 'trustedProxyHops' | 'trustedPlatform' | 'capture'>,
	production: boolean
): string | null =>
	production &&
	resolved.capture.installCountsWithoutConsent &&
	resolved.trustedProxyHops === undefined &&
	resolved.trustedPlatform === undefined
		? "analytics: a held capture slot counts visitors cookielessly, telling them apart by a hash of the client IP address, yet neither trustedProxyHops nor trustedPlatform is set. Behind a proxy, a missing or wrong hop count hashes the proxy's address instead and collapses every visitor into one. Set trustedPlatform to 'vercel' or 'cloudflare', or trustedProxyHops to the number of proxies in front of the app."
		: null
