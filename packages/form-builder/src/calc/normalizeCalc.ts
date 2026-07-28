import { CALC_OPS, type CalcExpression, type CalcOp, isCalcFn, MAX_DEPTH } from './types'

/**
 * The extension names a normalized expression may reference: registered calc source keys and custom
 * function names (plugin option `calc`). Absent (the default for every un-threaded caller), only the
 * built-in grammar is valid: `source` nodes, sourced weights, and custom fns all reject.
 */
export type CalcAllowed = {
	sources?: ReadonlySet<string>
	functions?: ReadonlySet<string>
}

const isOp = (v: unknown): v is CalcOp => (CALC_OPS as readonly unknown[]).includes(v)

const isRecord = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v)

const normalizeNode = (
	value: unknown,
	depth: number,
	allowed?: CalcAllowed
): CalcExpression | undefined => {
	if (depth > MAX_DEPTH) return undefined
	if (!isRecord(value)) return undefined

	switch (value.type) {
		case 'lit': {
			const { value: v } = value
			if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
			return { type: 'lit', value: v }
		}
		case 'ref': {
			const { field } = value
			if (typeof field !== 'string') return undefined
			return { type: 'ref', field }
		}
		case 'op': {
			const { op, left, right } = value
			if (!isOp(op)) return undefined
			const l = normalizeNode(left, depth + 1, allowed)
			if (!l) return undefined
			const r = normalizeNode(right, depth + 1, allowed)
			if (!r) return undefined
			return { type: 'op', op, left: l, right: r }
		}
		case 'neg': {
			const operand = normalizeNode(value.operand, depth + 1, allowed)
			if (!operand) return undefined
			return { type: 'neg', operand }
		}
		case 'fn': {
			const { fn, args } = value
			if (typeof fn !== 'string') return undefined
			if (!isCalcFn(fn) && !allowed?.functions?.has(fn)) return undefined
			if (!Array.isArray(args)) return undefined
			const normalizedArgs: CalcExpression[] = []
			for (const arg of args) {
				const a = normalizeNode(arg, depth + 1, allowed)
				if (!a) return undefined
				normalizedArgs.push(a)
			}
			return { type: 'fn', fn, args: normalizedArgs }
		}
		case 'source': {
			const { source } = value
			if (typeof source !== 'string') return undefined
			if (!allowed?.sources?.has(source)) return undefined
			return { type: 'source', source }
		}
		case 'weight': {
			const { field, weights, source } = value
			if (typeof field !== 'string') return undefined
			if (source !== undefined) {
				if (typeof source !== 'string' || !allowed?.sources?.has(source)) return undefined
			}
			let normalizedWeights: Record<string, number> | undefined
			if (weights !== undefined) {
				if (!isRecord(weights)) return undefined
				normalizedWeights = {}
				for (const [k, v] of Object.entries(weights)) {
					if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
					normalizedWeights[k] = v
				}
			}
			// A weight must carry a per-option map from somewhere: inline weights or a registered source.
			if (normalizedWeights === undefined && source === undefined) return undefined
			return {
				type: 'weight',
				field,
				...(normalizedWeights !== undefined ? { weights: normalizedWeights } : {}),
				...(typeof source === 'string' ? { source } : {}),
			}
		}
		default:
			return undefined
	}
}

/**
 * Structural guard: returns a valid CalcExpression if `value` is structurally sound (depth-guarded
 * at 64), otherwise undefined. Never throws. `allowed` admits registered extension names (source
 * keys, custom function names); without it only the built-in grammar passes, so an un-threaded
 * caller can never validate an expression the evaluator has no values for.
 */
export const normalizeCalc = (value: unknown, allowed?: CalcAllowed): CalcExpression | undefined =>
	normalizeNode(value, 0, allowed)
