/** Canonical operator grammar; `CalcExpression`, `normalizeCalc`, and the admin editor's jsonSchema all derive from this list. */
export const CALC_OPS = ['+', '-', '*', '/', '%'] as const
export type CalcOp = (typeof CALC_OPS)[number]

/** Canonical function grammar; same single source of truth as `CALC_OPS`. */
export const CALC_FNS = ['min', 'max', 'round', 'abs', 'ceil', 'floor'] as const
export type CalcFn = (typeof CALC_FNS)[number]

export const isCalcFn = (v: unknown): v is CalcFn => (CALC_FNS as readonly unknown[]).includes(v)

/**
 * A function slot in the AST: a built-in, or a host-registered function name (plugin option
 * `calc.functions`). The intersection trick keeps built-in autocomplete while admitting any
 * registered key; `normalizeCalc` gates which names are actually valid.
 */
export type CalcFnName = CalcFn | (string & {})

/** Recursion guard shared by `normalizeCalc` (parse) and `evaluate` (walk) so both bound depth identically. */
export const MAX_DEPTH = 64

/**
 * A serializable, safe-by-construction calculation expression. No strings are parsed; the evaluator
 * tree-walks this closed node set (never `eval`). `source` reads a server-resolved scalar from a
 * registered calc source; a `weight` node with `source` reads its per-option map from a registered
 * weight resolver instead of the inline `weights` (which is then ignored).
 */
export type CalcExpression =
	| { type: 'lit'; value: number }
	| { type: 'ref'; field: string }
	| { type: 'op'; op: CalcOp; left: CalcExpression; right: CalcExpression }
	| { type: 'neg'; operand: CalcExpression }
	| { type: 'fn'; fn: CalcFnName; args: CalcExpression[] }
	| { type: 'source'; source: string }
	| { type: 'weight'; field: string; weights?: Record<string, number>; source?: string }
