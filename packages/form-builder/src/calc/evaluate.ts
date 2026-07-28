import { type CalcExpression, MAX_DEPTH } from './types'

/**
 * Server-resolved calc extension values, threaded into evaluation as data (never re-resolved
 * here, so the evaluator stays sync and isomorphic). `sources`/`weights` are serializable and
 * ride the form document for the client's live preview; `functions` never serialize and are
 * supplied per environment (registry `apply` fns on the server, the Form prop on the client).
 */
export type CalcResolved = {
	sources?: Record<string, number>
	/** Keyed `source + ' ' + field` (see `calcWeightKey` / `resolveCalcContext`). */
	weights?: Record<string, Record<string, number>>
	functions?: Record<string, (args: number[]) => number>
}

/**
 * The `CalcResolved.weights` key for a sourced weight node: source key + space + field name.
 * Unambiguous because registered source keys can never contain a space
 * (`assertValidCalcSourceKeys` enforces `[\w.-]` at boot), so the first space always ends the
 * source segment.
 */
export const calcWeightKey = (source: string, field: string): string => `${source} ${field}`

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

type EvalContext = { answers: Record<string, unknown>; resolved?: CalcResolved }

const evalNode = (expr: CalcExpression, ctx: EvalContext, depth: number): number => {
	if (depth > MAX_DEPTH || expr == null || typeof expr !== 'object') {
		return 0
	}
	const { answers, resolved } = ctx
	switch (expr.type) {
		case 'lit':
			return finite(toNumber(expr.value))
		case 'ref':
			return toNumber(answers[expr.field])
		case 'source':
			return toNumber(resolved?.sources?.[expr.source])
		case 'neg':
			return finite(-evalNode(expr.operand, ctx, depth + 1))
		case 'op': {
			const l = evalNode(expr.left, ctx, depth + 1)
			const r = evalNode(expr.right, ctx, depth + 1)
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
			// Built-ins always win, so a resolved custom fn can never shadow the canonical grammar.
			const fn = FUNCTIONS[expr.fn] ?? resolved?.functions?.[expr.fn]
			if (!fn) {
				return 0
			}
			const args = Array.isArray(expr.args) ? expr.args.map((a) => evalNode(a, ctx, depth + 1)) : []
			// Custom fns are host code: a throw must degrade to 0, not break the whole evaluation.
			try {
				return finite(fn(args))
			} catch {
				return 0
			}
		}
		case 'weight': {
			// A sourced weight always reads the resolved map (missing map -> 0 per chosen); inline weights are ignored.
			const weights =
				typeof expr.source === 'string'
					? (resolved?.weights?.[calcWeightKey(expr.source, expr.field)] ?? {})
					: (expr.weights ?? {})
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

/**
 * Evaluate a calc expression against form answers. Total + safe: no `eval`, always finite, div/mod
 * by zero -> 0, missing ref -> 0, depth-guarded. Isomorphic (client + server). `resolved` supplies
 * server-resolved source values, sourced weight maps, and custom functions; any extension node
 * whose value is absent evaluates to 0.
 */
export const evaluateCalc = (
	expr: CalcExpression | null | undefined,
	answers: Record<string, unknown>,
	resolved?: CalcResolved
): number => {
	if (!expr) {
		return 0
	}
	return evalNode(expr, { answers, resolved }, 0)
}
