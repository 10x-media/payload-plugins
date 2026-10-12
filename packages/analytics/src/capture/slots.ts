import type { PayloadRequest } from 'payload'
import type { AnalyticsAdapter } from '../core/contract'
import type { CaptureGateArgs } from '../core/options'
import { isOneOf } from '../core/values'
import {
	type AnalyticsRuntime,
	resolveCaptureScopeFor,
	resolveRegistryFor,
} from '../plugin/runtime'
import type { CaptureClientKind, CaptureSlot } from '../tracker/config'
import { captureRequest } from './captureRequest'

export const CAPTURE_SLOTS: readonly CaptureSlot[] = ['global', 'tenant']

export const isCaptureSlot = (value: string): value is CaptureSlot => isOneOf(CAPTURE_SLOTS, value)

/** The adapter the global slot falls to when none is configured: the platform's, else the only one. */
const defaultGlobalId = (runtime: AnalyticsRuntime): string | undefined => {
	if (runtime.platformAdapterId) {
		return runtime.platformAdapterId
	}
	const all = runtime.registry.all()
	return all.length === 1 ? all[0]?.id : undefined
}

/**
 * The adapter filling one capture slot for this request, or null; any failure degrades to null so
 * the proxy 404s. Pass `scope` to reuse a resolved one; a slot configured `false` resolves nothing.
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
			const id = configured || defaultGlobalId(runtime)
			return id === undefined ? null : runtime.registry.get(id)
		}
		// The visitor's request: the slot follows the site an editor is on, not their admin tenant.
		const visitor = captureRequest(req)
		const resolved = scope === undefined ? await resolveCaptureScopeFor(runtime, visitor) : scope
		if (resolved === null) {
			return null
		}
		const { registry, grants } = await resolveRegistryFor(runtime, {
			payload: req.payload,
			req: visitor,
			scope: resolved,
		})
		// Only a granted source may fill it, so a tenant without a native document gets no beacon.
		const candidates = runtime.providersCollection
			? registry.all().filter((adapter) => grants.has(adapter.id))
			: registry.all()
		if (configured) {
			return candidates.find((adapter) => adapter.id === configured) ?? null
		}
		// The default source only when it can capture: one that cannot would leave the slot empty.
		const preferred = registry.default()
		return (
			candidates.find((adapter) => adapter.id === preferred.id && adapter.capture) ??
			candidates.find((adapter) => adapter.capture) ??
			null
		)
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

/** Whether the slot may hold `adapterId`, judged with no request: the tenant slot on any scoped install. */
const mayFill = (runtime: AnalyticsRuntime, slot: CaptureSlot, adapterId: string): boolean => {
	const configured = runtime.captureSlots?.[slot]
	if (configured === false) {
		return false
	}
	if (typeof configured === 'string') {
		return configured === adapterId
	}
	if (slot === 'tenant') {
		return runtime.scoped === true || runtime.resolveScope !== undefined
	}
	return defaultGlobalId(runtime) === adapterId
}

/**
 * Whether `capture.gate` holds one slot. No gate, and a gate that throws (reported to `onError`),
 * hold it: capturing without the host's say-so is the one answer this must never give by accident.
 */
export const gateHolds = (
	runtime: AnalyticsRuntime,
	args: CaptureGateArgs,
	onError?: (err: unknown) => void
): boolean => {
	if (!runtime.captureGate) {
		return true
	}
	try {
		return runtime.captureGate(args)
	} catch (err) {
		onError?.(err)
		return true
	}
}

/** Whether `capture.gate` holds any slot the adapter may fill, for a caller with no request. */
export const gateHoldsAdapter = (
	runtime: AnalyticsRuntime,
	adapterId: string,
	kind: CaptureClientKind
): boolean =>
	CAPTURE_SLOTS.some(
		(slot) => mayFill(runtime, slot, adapterId) && gateHolds(runtime, { slot, adapterId, kind })
	)
