import type { Payload, PayloadRequest } from 'payload'
import { CALC_FNS } from './types'

export type CalcSourceResolveArgs = {
	form: { id: number | string } & Record<string, unknown>
	payload: Payload
	req?: PayloadRequest
}

export type CalcWeightResolveArgs = CalcSourceResolveArgs & {
	/** The field instance whose options are being priced (name, blockType, options, custom config). */
	field: Record<string, unknown> & { name: string }
}

/**
 * A named server-side value resolver the calculation field can reference. Values resolve on the
 * server (render embedding and again at submit), so the client never supplies them. A source may
 * offer either mode or both; an expression using a mode the source does not implement fails
 * loudly at resolution.
 */
export type CalcSource = {
	label: string | Record<string, string>
	/** Scalar mode: one number for the whole form render/submission. */
	resolve?: (args: CalcSourceResolveArgs) => number | Promise<number>
	/** Weight mode: per-option values for a chosen field, keyed by option value. */
	resolveWeights?: (
		args: CalcWeightResolveArgs
	) => Record<string, number> | Promise<Record<string, number>>
}

/** A host-registered calculation function; `apply` must be pure and sync (it runs isomorphically in the live preview). */
export type CalcFunction = {
	label: string | Record<string, string>
	apply: (args: number[]) => number
}

/** Identity helper: define a calc source once with full typing (the `defineFormField` precedent). */
export const defineCalcSource = (source: CalcSource): CalcSource => source

/** Identity helper: define a calc function once with full typing (the `defineFormField` precedent). */
export const defineCalcFunction = (fn: CalcFunction): CalcFunction => fn

/**
 * Fail fast at boot when a registered calc function key collides with a built-in. The evaluator
 * always resolves built-ins first, so a colliding custom function could never run; rather than let
 * it be shadowed quietly, throw a clear error naming the collision so the author renames it.
 */
export const assertNoCalcFunctionCollision = (functions: Record<string, CalcFunction>): void => {
	for (const key of Object.keys(functions)) {
		if ((CALC_FNS as readonly string[]).includes(key)) {
			throw new Error(
				`@10x-media/form-builder: calculation function "${key}" collides with the built-in function "${key}". Rename the custom function.`
			)
		}
	}
}
