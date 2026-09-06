import type { PayloadRequest } from 'payload'
import type { CaptureClientKind, CaptureSnippet, CaptureSupport } from '../core/capture'
import { DEFAULT_AUTO_CAPTURE, defaultConsentFor, type ResolvedAutoCapture } from '../core/options'
import type { Goal, TrackerGoal } from '../goals/types'
import { INGEST_PATH, PROXY_PATH } from '../plugin/paths'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { normalizeMountPath } from './mountPath'
import { CAPTURE_SLOTS, type CaptureSlot, resolveSlotAdapter } from './slots'

export interface TrackerSlotConfig {
	slot: CaptureSlot
	kind: CaptureClientKind
	adapterId: string
	/** Mount the snippet and the sink talk to: the runtime proxy, or a `capture.paths` override. */
	path: string
	snippet: CaptureSnippet
	client: CaptureSupport['client']
	requiresConsent: boolean
}

/**
 * Everything the browser tracker needs, and nothing else. Serialized to any visitor by the
 * public tracker endpoint, so it carries only what an adapter puts in `capture.client` and
 * `capture.snippet`: never a query credential, never a goal's admin-facing name.
 */
export interface TrackerConfig {
	slots: TrackerSlotConfig[]
	autoCapture: ResolvedAutoCapture
	goals: TrackerGoal[]
	/** Where the native sink posts events, derived from the app's own `routes.api`. */
	ingestPath: string
}

const apiRoute = (req: PayloadRequest): string => req.payload?.config?.routes?.api ?? '/api'

const trackerGoals = (goals: Goal[] | undefined): TrackerGoal[] =>
	(goals ?? []).map(({ slug, match, value, currency }) => ({
		slug,
		match,
		...(value ? { value } : {}),
		...(currency ? { currency } : {}),
	}))

/** The config for an install with no runtime yet: no slots, but still a usable ingest path. */
export const emptyTrackerConfig = (req: PayloadRequest): TrackerConfig => ({
	slots: [],
	autoCapture: DEFAULT_AUTO_CAPTURE,
	goals: [],
	ingestPath: `${apiRoute(req)}${INGEST_PATH}`,
})

/**
 * The per-request tracker config: one entry per capture slot that resolves to an adapter
 * declaring `capture`, in slot order. A slot whose adapter does not resolve (no scope, an
 * unknown id, a throwing scope resolver) is simply absent, as is one whose snippet throws;
 * this runs on a public, unauthenticated path, so every failure degrades a slot away
 * rather than surfacing an error.
 */
export const resolveTrackerConfig = async (args: {
	runtime: AnalyticsRuntime
	req: PayloadRequest
}): Promise<TrackerConfig> => {
	const { runtime, req } = args
	const base = apiRoute(req)
	const slots: TrackerSlotConfig[] = []
	for (const slot of CAPTURE_SLOTS) {
		const adapter = await resolveSlotAdapter(runtime, req, slot)
		const capture = adapter?.capture
		if (!adapter || !capture) {
			continue
		}
		const override = runtime.capturePaths?.[slot]
		const path = override ? normalizeMountPath(override) : `${base}${PROXY_PATH}/${slot}`
		const kind = capture.client.kind
		try {
			slots.push({
				slot,
				kind,
				adapterId: adapter.id,
				path,
				snippet: capture.snippet({ path }),
				client: capture.client,
				requiresConsent:
					(runtime.consentFor?.(slot, adapter.id, kind) ?? defaultConsentFor(kind)) === 'required',
			})
		} catch (err) {
			req.payload?.logger?.warn(
				`analytics: capture snippet for "${adapter.id}" failed, dropping the ${slot} slot: ${String(err)}`
			)
		}
	}
	return {
		slots,
		autoCapture: runtime.autoCapture ?? DEFAULT_AUTO_CAPTURE,
		goals: trackerGoals(runtime.goals),
		ingestPath: `${base}${runtime.ingestPath ?? INGEST_PATH}`,
	}
}
