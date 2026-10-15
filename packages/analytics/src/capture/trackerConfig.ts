import type { Payload, PayloadRequest, SanitizedConfig } from 'payload'
import { formatAdminURL } from 'payload/shared'
import type { ResolvedGoal } from '../goals/resolver'
import { apiPath, appPath } from '../plugin/apiPath'
import { analyticsRoutes } from '../plugin/routes'
import {
	type AnalyticsRuntime,
	resolveCaptureScopeFor,
	resolveGoalsDetailedFor,
} from '../plugin/runtime'
import {
	type AdminDigest,
	type CaptureClientKind,
	type CaptureSlot,
	DEFAULT_AUTO_CAPTURE,
	type TrackerConfig,
	type TrackerExclusion,
	type TrackerGoal,
	type TrackerSlotConfig,
} from '../tracker/config'
import { DEFAULT_TRACKER_SKIP } from '../tracker/skip'
import { captureRequest } from './captureRequest'
import { withExclusionPrelude } from './exclusionPrelude'
import { exclusionToken, exclusionTokenHash, publicDigest } from './exclusionToken'
import { normalizeMountPath } from './mountPath'
import { CAPTURE_SLOTS, gateHolds, resolveSlotAdapterFor } from './slots'

/**
 * The admin's address as a page reaches it, behind the Next basePath, as digests: its origin only
 * when `serverURL` puts it on one, its path without a trailing slash.
 */
const adminDigest = (config: Partial<SanitizedConfig>): AdminDigest => {
	const address = formatAdminURL({
		adminRoute: config.routes?.admin ?? '/admin',
		path: '',
		serverURL: config.serverURL,
		includeBasePath: true,
	})
	let origin: string | undefined
	let path = address
	if (/^https?:\/\//i.test(address)) {
		try {
			const url = new URL(address)
			origin = url.origin
			path = url.pathname
		} catch {
			// A serverURL that does not parse: its digest matches no window, so no page reads as a preview.
		}
	}
	return {
		...(origin === undefined ? {} : { origin: publicDigest(origin) }),
		path: publicDigest(path.replace(/\/+$/, '') || '/'),
	}
}

/** What the config says about skipping: the install's choice when not the default, and the admin. */
const skipFields = (
	runtime: AnalyticsRuntime,
	config: Partial<SanitizedConfig>,
	draft: boolean
): Pick<TrackerConfig, 'skip' | 'draft' | 'admin'> => {
	const skip = runtime.captureSkip ?? DEFAULT_TRACKER_SKIP
	const changed =
		skip.automation !== DEFAULT_TRACKER_SKIP.automation ||
		skip.previews !== DEFAULT_TRACKER_SKIP.previews
	return {
		...(changed ? { skip: { ...skip } } : {}),
		...(draft ? { draft: true } : {}),
		...(skip.previews ? { admin: adminDigest(config) } : {}),
	}
}

const trackerGoals = (goals: ResolvedGoal[]): TrackerGoal[] =>
	goals
		.filter((entry) => entry.source !== 'builtin')
		.map(({ goal: { slug, match, value, currency } }) => ({
			slug,
			match,
			...(value ? { value } : {}),
			...(currency ? { currency } : {}),
		}))

/** The visit's scope, or null when the host's resolver has none or throws. */
const scopeFor = async (runtime: AnalyticsRuntime, req: PayloadRequest): Promise<string | null> => {
	try {
		return await resolveCaptureScopeFor(runtime, req)
	} catch (err) {
		req.payload?.logger?.warn(`analytics: tracker config scope resolution failed: ${String(err)}`)
		return null
	}
}

/** The scope's merged goals, falling back to the config goals when the merge fails. */
const goalsFor = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<ResolvedGoal[]> => {
	try {
		return await resolveGoalsDetailedFor(runtime, req, scope)
	} catch (err) {
		req.payload?.logger?.warn(
			`analytics: tracker config goals resolution failed, falling back to config goals: ${String(err)}`
		)
		return (runtime.goals ?? []).map((goal) => ({ goal, source: 'config' as const }))
	}
}

/** The scope's exclusion link as the tracker sees it: the token's hash, never the token. */
const exclusionFor = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): TrackerExclusion | undefined => {
	const secret = req.payload?.secret
	if (!runtime.exclusion || typeof secret !== 'string' || secret === '') {
		return undefined
	}
	return {
		param: runtime.exclusion.param,
		tokenHash: exclusionTokenHash(exclusionToken(secret, scope)),
	}
}

/** The Payload instances that already logged a vendor filling both slots, so a busy site hears it once. */
const warnedSharedVendor = new WeakSet<Payload>()

/**
 * The vendors whose browser SDK runs a second client beside the first, each with its own project,
 * gate and storage: a second slot of one of these kinds captures through a client named after it.
 */
const NAMED_CLIENT_KINDS: ReadonlySet<CaptureClientKind> = new Set<CaptureClientKind>(['posthog'])

/** Why the second slot of one vendor kind is left out, logged once per instance. */
const warnSharedVendor = (
	payload: Payload | undefined,
	args: { slot: CaptureSlot; adapterId: string; kind: CaptureClientKind; first: TrackerSlotConfig }
): void => {
	if (!payload || warnedSharedVendor.has(payload)) {
		return
	}
	warnedSharedVendor.add(payload)
	payload.logger?.warn(
		`analytics: the ${args.slot} slot resolved to "${args.adapterId}", a second ${args.kind} slot beside "${args.first.adapterId}" on the ${args.first.slot} slot. ${args.kind} runs one client per page, so two slots of it would share that client: neither slot's gate could be answered alone and the ${args.slot} slot's events could land in the other slot's project. The ${args.slot} slot is left out of the tracker config; only PostHog runs a second client beside the first. Logged once.`
	)
}

/**
 * The per-request tracker config, one entry per capturing slot in slot order. Public and anonymous
 * (the visitor's request, no user or cookies), so any failure drops a slot instead of erroring.
 */
export const resolveTrackerConfig = async (args: {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	/** The page is rendered in draft mode, which `capture.skip.previews` leaves uncounted. */
	draft?: boolean
}): Promise<TrackerConfig> => {
	const { runtime } = args
	const req = captureRequest(args.req)
	const config = req.payload?.config ?? {}
	const routes = analyticsRoutes(req.payload?.config)
	// One scope resolution for the whole config: the slots and the goals must agree on it,
	// and the host's resolver can be as expensive as a database read.
	const scope = await scopeFor(runtime, req)
	const exclusion = exclusionFor(runtime, req, scope)
	const slots: TrackerSlotConfig[] = []
	const filled = new Set<string>()
	for (const slot of CAPTURE_SLOTS) {
		const adapter = await resolveSlotAdapterFor({ runtime, req, slot, scope })
		const capture = adapter?.capture
		// One adapter fills one slot: two sinks for it would send every event twice.
		if (!adapter || !capture || filled.has(adapter.id)) {
			continue
		}
		const kind = capture.client.kind
		const first = slots.find((entry) => entry.kind === kind)
		if (first && !NAMED_CLIENT_KINDS.has(kind)) {
			warnSharedVendor(req.payload, { slot, adapterId: adapter.id, kind, first })
			continue
		}
		const instance = first ? slot : undefined
		const override = runtime.capturePaths?.[slot]
		const path = override
			? appPath(normalizeMountPath(override))
			: apiPath(config, `${routes.proxy}/${slot}`)
		const gated = gateHolds(runtime, { slot, adapterId: adapter.id, kind }, (err) =>
			req.payload?.logger?.warn(
				`analytics: capture.gate threw for the ${slot} slot, which waits: ${String(err)}`
			)
		)
		try {
			slots.push({
				slot,
				kind,
				adapterId: adapter.id,
				path,
				snippet: withExclusionPrelude(
					capture.snippet({ path, scope, ...(instance ? { instance } : {}) }),
					exclusion?.param
				),
				client: capture.client,
				...(instance ? { instance } : {}),
				gated,
			})
			filled.add(adapter.id)
		} catch (err) {
			req.payload?.logger?.warn(
				`analytics: capture snippet for "${adapter.id}" failed, dropping the ${slot} slot: ${String(err)}`
			)
		}
	}
	return {
		slots,
		autoCapture: runtime.autoCapture ?? DEFAULT_AUTO_CAPTURE,
		goals: trackerGoals(await goalsFor(runtime, req, scope)),
		ingestPath: apiPath(config, runtime.ingestPath ?? routes.ingest),
		...(exclusion ? { exclusion } : {}),
		...skipFields(runtime, config, args.draft === true),
	}
}
