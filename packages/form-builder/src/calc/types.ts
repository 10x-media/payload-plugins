/** Canonical operator grammar; `CalcExpression`, `normalizeCalc`, and the admin editor's jsonSchema all derive from this list. */
export const CALC_OPS = ['+', '-', '*', '/', '%'] as const
export type CalcOp = (typeof CALC_OPS)[number]

/** Canonical function grammar; same single source of truth as `CALC_OPS`. */
export const CALC_FNS = ['min', 'max', 'round', 'abs', 'ceil', 'floor'] as const
export type CalcFn = (typeof CALC_FNS)[number]

/** Recursion guard shared by `normalizeCalc` (parse) and `evaluate` (walk) so both bound depth identically. */
export const MAX_DEPTH = 64

/** A serializable, safe-by-construction calculation expression. No strings are parsed; the evaluator tree-walks this closed node set (never `eval`). */
export type CalcExpression =
	| { type: 'lit'; value: number }
	| { type: 'ref'; field: string }
	| { type: 'op'; op: CalcOp; left: CalcExpression; right: CalcExpression }
	| { type: 'neg'; operand: CalcExpression }
	| { type: 'fn'; fn: CalcFn; args: CalcExpression[] }
	| { type: 'weight'; field: string; weights: Record<string, number> }
