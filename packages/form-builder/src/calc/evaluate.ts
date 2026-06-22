import type { CalcExpression } from './types'

const MAX_DEPTH = 64

const toNumber = (value: unknown): number => {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : 0
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value)
		return Number.isFinite(n) ? n : 0
	}
	return 0
}

const finite = (n: number): number => (Number.isFinite(n) ? n : 0)

const FUNCTIONS: Record<string, (args: number[]) => number> = {
	min: (a) => (a.length ? Math.min(...a) : 0),
	max: (a) => (a.length ? Math.max(...a) : 0),
	round: (a) => Math.round(a[0] ?? 0),
	abs: (a) => Math.abs(a[0] ?? 0),
	ceil: (a) => Math.ceil(a[0] ?? 0),
	floor: (a) => Math.floor(a[0] ?? 0),
}

const evalNode = (
	expr: CalcExpression,
	answers: Record<string, unknown>,
	depth: number
): number => {
	if (depth > MAX_DEPTH || expr == null || typeof expr !== 'object') {
		return 0
	}
	switch (expr.type) {
		case 'lit':
			return finite(toNumber(expr.value))
		case 'ref':
			return toNumber(answers[expr.field])
		case 'neg':
			return finite(-evalNode(expr.operand, answers, depth + 1))
		case 'op': {
			const l = evalNode(expr.left, answers, depth + 1)
			const r = evalNode(expr.right, answers, depth + 1)
			switch (expr.op) {
				case '+':
					return finite(l + r)
				case '-':
					return finite(l - r)
				case '*':
					return finite(l * r)
				case '/':
					return r === 0 ? 0 : finite(l / r)
				case '%':
					return r === 0 ? 0 : finite(l % r)
				default:
					return 0
			}
		}
		case 'fn': {
			const fn = FUNCTIONS[expr.fn]
			if (!fn) {
				return 0
			}
			const args = Array.isArray(expr.args)
				? expr.args.map((a) => evalNode(a, answers, depth + 1))
				: []
			return finite(fn(args))
		}
		case 'weight': {
			const weights = expr.weights ?? {}
			const value = answers[expr.field]
			const chosen = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
			return finite(
				chosen.reduce((sum: number, v: unknown) => sum + toNumber(weights[String(v)]), 0)
			)
		}
		default:
			return 0
	}
}

/** Evaluate a calc expression against form answers. Total + safe: no `eval`, always finite, div/mod by zero -> 0, missing ref -> 0, depth-guarded. Isomorphic (client + server). */
export const evaluateCalc = (
	expr: CalcExpression | null | undefined,
	answers: Record<string, unknown>
): number => {
	if (!expr) {
		return 0
	}
	return evalNode(expr, answers, 0)
}
