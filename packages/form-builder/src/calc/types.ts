/** A serializable, safe-by-construction calculation expression. No strings are parsed; the evaluator tree-walks this closed node set (never `eval`). */
export type CalcExpression =
	| { type: 'lit'; value: number }
	| { type: 'ref'; field: string }
	| { type: 'op'; op: '+' | '-' | '*' | '/' | '%'; left: CalcExpression; right: CalcExpression }
	| { type: 'neg'; operand: CalcExpression }
	| { type: 'fn'; fn: 'min' | 'max' | 'round' | 'abs' | 'ceil' | 'floor'; args: CalcExpression[] }
	| { type: 'weight'; field: string; weights: Record<string, number> }
