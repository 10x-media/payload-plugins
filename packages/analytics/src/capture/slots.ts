import type { PayloadRequest } from 'payload'
import type { AnalyticsAdapter } from '../core/contract'
import { type AnalyticsRuntime, resolveRegistryFor, resolveScopeFor } from '../plugin/runtime'

/** The two capture slots an install can fill: the platform's own and the tenant's. */
export type CaptureSlot = 'global' | 'tenant'

export const CAPTURE_SLOTS: readonly CaptureSlot[] = ['global', 'tenant']

export const isCaptureSlot = (value: string): value is CaptureSlot =>
	(CAPTURE_SLOTS as readonly string[]).includes(value)

/**
 * The adapter filling one capture slot for this request, or null when the slot is
 * unfilled. `global` is install-wide, so it resolves out of the config registry only:
 * the `capture.slots.global` override, else the designated `platformAdapter`, else the
 * single config adapter when there is exactly one. `tenant` resolves out of the
 * request's own per-scope registry (which includes that scope's runtime providers) and
 * is null whenever no scope resolves. Any resolution failure degrades to null, so the
 * proxy 404s instead of throwing.
 *
 * A slot configured `false` is null before any of that runs: an explicit disable outranks
 * every default, and nothing happens on its behalf, not even a scope lookup.
 *
 * `scope` passes in an already-resolved scope so a caller filling both slots (and the
 * request's goals) calls the host's resolver once; omit it and the tenant slot resolves
 * its own.
 */
export const resolveSlotAdapterFor = async (args: {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	slot: CaptureSlot
	scope?: string | null
}): Promise<AnalyticsAdapter | null> => {
	const { runtime, req, slot, scope } = args
	const configured = runtime.captureSlots?.[slot]
	if (configured === false) {
		return null
	}
	try {
		if (slot === 'global') {
			if (configured) {
				return runtime.registry.get(configured)
			}
			if (runtime.platformAdapterId) {
				return runtime.registry.get(runtime.platformAdapterId)
			}
			const all = runtime.registry.all()
			return all.length === 1 ? (all[0] as AnalyticsAdapter) : null
		}
		const resolved = scope === undefined ? await resolveScopeFor(runtime, req) : scope
		if (resolved === null) {
			return null
		}
		const registry = await resolveRegistryFor(runtime, {
			payload: req.payload,
			req,
			scope: resolved,
		})
		return configured ? registry.get(configured) : registry.default()
	} catch (err) {
		req.payload?.logger?.warn(`analytics: capture slot "${slot}" resolution failed: ${String(err)}`)
		return null
	}
}

/** {@link resolveSlotAdapterFor} for a caller holding one slot and no scope of its own. */
export const resolveSlotAdapter = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	slot: CaptureSlot
): Promise<AnalyticsAdapter | null> => resolveSlotAdapterFor({ runtime, req, slot })
