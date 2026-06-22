import type { CalcExpression } from './types'

const MAX_DEPTH = 64

const OP_SET = new Set(['+', '-', '*', '/', '%'])
const FN_SET = new Set(['min', 'max', 'round', 'abs', 'ceil', 'floor'])

const isRecord = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v)

const normalizeNode = (value: unknown, depth: number): CalcExpression | undefined => {
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
			if (typeof op !== 'string' || !OP_SET.has(op)) return undefined
			const l = normalizeNode(left, depth + 1)
			if (!l) return undefined
			const r = normalizeNode(right, depth + 1)
			if (!r) return undefined
			return { type: 'op', op: op as '+' | '-' | '*' | '/' | '%', left: l, right: r }
		}
		case 'neg': {
			const operand = normalizeNode(value.operand, depth + 1)
			if (!operand) return undefined
			return { type: 'neg', operand }
		}
		case 'fn': {
			const { fn, args } = value
			if (typeof fn !== 'string' || !FN_SET.has(fn)) return undefined
			if (!Array.isArray(args)) return undefined
			const normalizedArgs: CalcExpression[] = []
			for (const arg of args) {
				const a = normalizeNode(arg, depth + 1)
				if (!a) return undefined
				normalizedArgs.push(a)
			}
			return {
				type: 'fn',
				fn: fn as 'min' | 'max' | 'round' | 'abs' | 'ceil' | 'floor',
				args: normalizedArgs,
			}
		}
		case 'weight': {
			const { field, weights } = value
			if (typeof field !== 'string') return undefined
			if (!isRecord(weights)) return undefined
			const normalizedWeights: Record<string, number> = {}
			for (const [k, v] of Object.entries(weights)) {
				if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
				normalizedWeights[k] = v
			}
			return { type: 'weight', field, weights: normalizedWeights }
		}
		default:
			return undefined
	}
}

/** Structural guard: returns a valid CalcExpression if `value` is structurally sound (depth-guarded at 64), otherwise undefined. Never throws. */
export const normalizeCalc = (value: unknown): CalcExpression | undefined => normalizeNode(value, 0)
